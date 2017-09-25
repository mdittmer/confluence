// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

//
// Update API and metrics data in Datastore. This script assumes that it is
// the only writer to the datastore namespace.
//

const fs = require('fs');
const path = require('path');

global.FOAM_FLAGS = {gcloud: true};
require('foam2');

require('../lib/confluence/aggressive_removal.es6.js');
require('../lib/confluence/api_velocity.es6.js');
require('../lib/confluence/browser_specific.es6.js');
require('../lib/confluence/failure_to_ship.es6.js');
require('../lib/confluence/set_ops.es6.js');
require('../lib/datastore/datastore_container.es6.js');
require('../lib/datastore/updater.es6.js');
require('../lib/web_apis/release.es6.js');
require('../lib/web_apis/release_interface_relationship.es6.js');
require('../lib/web_apis/web_interface.es6.js');
require('../lib/web_catalog/object_graph_importer.es6.js');

//
// Setup contexts for writing to datastore, caching a local copy of current
// Datastore data, and loading/computing new data to be imported.
//

const credentials = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../.local/credentials.json')));

const logger = foam.log.ConsoleLogger.create();

const pkg = org.chromium.apis.web;

const ctx = foam.__context__.createSubContext({
  logger: logger,
});

// Context for unversioned cache loaded from Datastore.
const cacheCtx = pkg.DAOContainer.create({
  releaseDAO: foam.dao.MDAO.create({of: pkg.Release}),
  webInterfaceDAO: foam.dao.MDAO.create({of: pkg.WebInterface}),
  releaseWebInterfaceJunctionDAO: foam.dao.MDAO.create({
    of: pkg.ReleaseWebInterfaceJunction,
  }),
  browserMetricsDAO: foam.dao.MDAO.create({of: pkg.BrowserMetricData}),
  apiVelocityDAO: foam.dao.MDAO.create({of: pkg.ApiVelocityData}),
}, ctx);

// Context for local data to be imported into Datastore.
const importCtx = pkg.DAOContainer.create({
  releaseDAO: foam.dao.MDAO.create({of: pkg.Release}),
  webInterfaceDAO: foam.dao.MDAO.create({of: pkg.WebInterface}),
  releaseWebInterfaceJunctionDAO: foam.dao.MDAO.create({
    of: pkg.ReleaseWebInterfaceJunction,
  }),
  browserMetricsDAO: foam.dao.MDAO.create({of: pkg.BrowserMetricData}),
  apiVelocityDAO: foam.dao.MDAO.create({of: pkg.ApiVelocityData}),
}, ctx);

// Context for reading from / writing to Datastore.
//
// TODO(markdittmer): Figure out why partitioning isn't working. This component
// was originally to be instantiated in context:
//
// foam.__context__.createSubContext({
//   datastoreNamespaceId: 'someDatastoreNamespace'
// })
//
// but it was discovered that put()s were going to the default namespace, even
// though queries were correctly scoped to 'someDatastoreNamespace'.
const datastoreCtx = pkg.DatastoreContainer.create({
  mode: pkg.DatastoreContainerMode.DATA_COLLECTOR,
  gcloudAuthEmail: credentials.client_email,
  gcloudAuthPrivateKey: credentials.private_key,
  gcloudProjectId: credentials.project_id,
  logger: logger,
}).ctx;

const importer = pkg.ObjectGraphImporter.create({
  objectGraphPath: path.resolve(__dirname, '../data/og'),
}, importCtx);

// SyncDAOs connected to Datastore.
const releaseSyncDAO = datastoreCtx.releaseDAO;
const webInterfaceSyncDAO = datastoreCtx.webInterfaceDAO;
const releaseWebInterfaceJunctionSyncDAO =
    datastoreCtx.releaseWebInterfaceJunctionDAO;
const browserMetricsSyncDAO = datastoreCtx.browserMetricsDAO;
const apiVelocitySyncDAO = datastoreCtx.apiVelocityDAO;

// An unversioned cache of current Datastore.
const releaseCacheDAO = cacheCtx.releaseDAO;
const webInterfaceCacheDAO = cacheCtx.webInterfaceDAO;
const releaseWebInterfaceJunctionCacheDAO =
    cacheCtx.releaseWebInterfaceJunctionDAO;
const browserMetricsCacheDAO = cacheCtx.browserMetricsDAO;
const apiVelocityCacheDAO = cacheCtx.apiVelocityDAO;

// In-memory DAOs of new data to be imported.
const releaseImportDAO = importCtx.releaseDAO;
const webInterfaceImportDAO = importCtx.webInterfaceDAO;
const releaseWebInterfaceJunctionImportDAO =
    importCtx.releaseWebInterfaceJunctionDAO;
const browserMetricsImportDAO = importCtx.browserMetricsDAO;
const apiVelocityImportDAO = importCtx.apiVelocityDAO;

//
// Add indices to make relational queries faster.
//

let junctionDAO = releaseWebInterfaceJunctionSyncDAO;
while (junctionDAO && !foam.dao.MDAO.isInstance(junctionDAO)) {
  junctionDAO = junctionDAO.delegate;
}
if (junctionDAO) {
  logger.info('Adding junction DAO indices');
  junctionDAO.addPropertyIndex(
      pkg.ReleaseWebInterfaceJunction.SOURCE_ID);
  junctionDAO.addPropertyIndex(
      pkg.ReleaseWebInterfaceJunction.TARGET_ID);
  junctionDAO.addPropertyIndex(
      pkg.ReleaseWebInterfaceJunction.SOURCE_ID,
      pkg.ReleaseWebInterfaceJunction.TARGET_ID);
  logger.info('Added junction DAO indices');
} else {
  logger.warn('No indexed DAO found in junction DAO delegate chain');
}

//
// Generic algorithm for data import:
// (1) In parallel:
// (1a) Sync and unversion Datastore data;
// (1b) Load/compute new data;
// (2) Import new data by put()ing what's changed and remove()ing anything in
//     unversioned Datastore cache that does not also appear in new data.
//

const updater = pkg.DatastoreUpdater.create();
function doImport(sync, load, daosArray) {
  return Promise.all([
    sync().then(function() {
      return Promise.all(daosArray.map(function(daos) {
        return updater.unversionData(daos.sync, daos.cache);
      }));
    }),
    load(),
  ]).then(function() {
    return Promise.all(daosArray.map(function(daos) {
      return updater.importData(daos.import, daos.cache, daos.sync);
    }));
  });
}

//
// Sync + load functions for API data.
//

function syncAPIData() {
  logger.info('Syncing API data');
  return Promise.all([
    releaseSyncDAO.synced,
    webInterfaceSyncDAO.synced,
    releaseWebInterfaceJunctionSyncDAO.synced,
  ]).then(function() {
    logger.info('Synced API data');
  });
}

function loadLocalData() {
  logger.info('Loading local data into memory');
  return importer.import().then(function() {
    logger.info('Data loaded into memory');
  });
}

//
// Sync + load functions for metrics data. Assumes importCtx contains new API
// data already.
//

function syncMetricData() {
  logger.info('Syncing metric data');
  return Promise.all([
    browserMetricsSyncDAO.synced,
    apiVelocitySyncDAO.synced,
  ]).then(function() {
    logger.info('Synced metric data');
  });
}

function computeMetrics() {
  logger.info('Computing API metrics');

  return Promise.all([
    pkg.AggressiveRemoval.create(null, importCtx).run(),
    pkg.BrowserSpecific.create(null, importCtx).run(),
    pkg.FailureToShip.create(null, importCtx).run(),
    pkg.ApiVelocity.create(null, importCtx).run(),
  ]).then(function() {
    logger.info('Computed API metrics');
  });
}

//
// Do the import! First API data, then metrics data.
//

doImport(syncAPIData, loadLocalData, [
  {
    sync: releaseSyncDAO,
    cache: releaseCacheDAO,
    import: releaseImportDAO,
  },
  {
    sync: webInterfaceSyncDAO,
    cache: webInterfaceCacheDAO,
    import: webInterfaceImportDAO,
  },
  {
    sync: releaseWebInterfaceJunctionSyncDAO,
    cache: releaseWebInterfaceJunctionCacheDAO,
    import: releaseWebInterfaceJunctionImportDAO,
  },
]).then(doImport.bind(this, syncMetricData, computeMetrics, [
  {
    sync: browserMetricsSyncDAO,
    cache: browserMetricsCacheDAO,
    import: browserMetricsImportDAO,
  },
  {
    sync: apiVelocitySyncDAO,
    cache: apiVelocityCacheDAO,
    import: apiVelocityImportDAO,
  },
]));
