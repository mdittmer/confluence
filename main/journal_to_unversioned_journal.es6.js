// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

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

function getJournalDAO(name, cls, ctx, mode) {
  const filename = path.resolve(__dirname, `../data/${name}-journal.js`);
  logger.info(`Creating JDAO (mode=${mode}) in ${filename}`);
  return foam.dao.JDAO.create({
    of: cls,
    delegate: foam.dao.MDAO.create({of: cls}, ctx),
    journal: foam.dao.NodeFileJournal.create({
      of: cls,
      fd: fs.openSync(filename, mode),
    }, ctx),
  }, ctx);
}
function getOverwriteJournalDAO(name, cls, ctx) {
  return getJournalDAO(name, cls, ctx, 'w+');
}
function getReadJournalDAO(name, cls, ctx) {
  return getJournalDAO(name, cls, ctx, 'r');
}

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
  releaseDAO: getReadJournalDAO(pkg.Release.id, pkg.Release, ctx),
  webInterfaceDAO: getReadJournalDAO(
      pkg.WebInterface.id, pkg.WebInterface, ctx),
  releaseWebInterfaceJunctionDAO: getReadJournalDAO(
      pkg.ReleaseWebInterfaceJunction.id, pkg.ReleaseWebInterfaceJunction, ctx),
  browserMetricsDAO: getReadJournalDAO(
      pkg.BrowserMetricData.id, pkg.BrowserMetricData, ctx),
  apiVelocityDAO: getReadJournalDAO(
      pkg.ApiVelocityData.id, pkg.ApiVelocityData, ctx),
}, ctx);

// Context for local journaled export output.
const exportCtx = pkg.DAOContainer.create({
  releaseDAO: getOverwriteJournalDAO(
      pkg.VersionedRelease.id, pkg.VersionedRelease, ctx),
  webInterfaceDAO: getOverwriteJournalDAO(
      pkg.VersionedWebInterface.id, pkg.VersionedWebInterface, ctx),
  releaseWebInterfaceJunctionDAO: getOverwriteJournalDAO(
      pkg.VersionedReleaseWebInterfaceJunction.id,
      pkg.VersionedReleaseWebInterfaceJunction, ctx),
  browserMetricsDAO: getOverwriteJournalDAO(
      pkg.VersionedBrowserMetricData.id, pkg.VersionedBrowserMetricData, ctx),
  apiVelocityDAO: getOverwriteJournalDAO(
      pkg.VersionedApiVelocityData.id, pkg.VersionedApiVelocityData, ctx),
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

// Persistent DAOs of data that is exported. These will be later decorated with
// versioning after Datastore versions are synced.
const releaseExportDAO = exportCtx.releaseDAO;
const webInterfaceExportDAO = exportCtx.webInterfaceDAO;
const releaseWebInterfaceJunctionExportDAO =
    exportCtx.releaseWebInterfaceJunctionDAO;
const browserMetricsExportDAO = exportCtx.browserMetricsDAO;
const apiVelocityExportDAO = exportCtx.apiVelocityDAO;

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
    Promise.all(daosArray.map(sync)).then(() => {
      return Promise.all(daosArray.map(daos => {
        return updater.unversionData(daos.sync, daos.cache);
      }));
    }),
    load(),
  ]).then(() => {
    return Promise.all(daosArray.map(function(daos) {
      return updater.importData(daos.import, daos.cache, daos.export);
    }));
  });
}

//
// Sync + load functions.
//

function syncDatastoreData(daos) {
  function addVersioningToExportDAO(versionedDAO, exportDAO, ctx) {
    foam.assert(versionedDAO.of === exportDAO.of,
                `Expect versioned DAO and ExportDAO to have same "of"
                     (found: ${versionedDAO.of.id} and ${exportDAO.of.id})`);

    // TODO(markdittmer): Changing VersionNoDAO into a PromiseDAO (with a better
    // "readiness API") is an outstanding issue. This check should catch any API
    // change that this code cannot handle.
    foam.assert(foam.core.Boolean.isInstance(foam.dao.VersionNoDAO.READY_),
                'Expect VersionNoDAO to use "ready_" flag');

    logger.info(`Initializing export versioned ExportDAO for
                     ${exportDAO.of.id}`);

    // VersionNoDAO will initialize itself with the highest version number that
    // it finds in its delegate. Initialize one with the versioneDAO as the
    // delegate, then swap delegates and resolve returning Promise when
    // VersionNoDAO is initialized.
    const versionNoDAO = foam.dao.VersionNoDAO.create({
      of: versionedDAO.of,
      delegate: versionedDAO,
    }, ctx);
    return new Promise((resolve, reject) => {
      if (versionNoDAO.ready_) {
        versionNoDAO.delegate = exportDAO;
        logger.info(`Export versioned ExportDAO for ${exportDAO.of.id}
                         initialized`);
        resolve(versionNoDAO);
        return;
      }

      const subscription = versionNoDAO.ready_$.sub(() => {
        if (!versionNoDAO.ready_) return;

        versionNoDAO.delegate = exportDAO;
        logger.info(`Export versioned ExportDAO for ${exportDAO.of.id}
                         initialized`);
        resolve(versionNoDAO);
        subscription.detach();
      });
    });
  }

  logger.info(`Syncing Datastore data: ${daos.sync.of.id}`);
  // Sync data from Datastore.
  return daos.sync.synced
      // Wrap export DAO in versioning DAO
      .then(() => addVersioningToExportDAO.bind(this, daos.sync, daos.export,
                                                exportCtx))
      // Overwrite "export DAO" with versioned export DAO.
      .then(exportDAO => daos.export = exportDAO)
      .then(() => {
        logger.info(`Synced Datastore data: ${daos.sync.of.id}`);
      });
}

function loadJournaledData() {
  logger.info('Loading journaled data');
  return Promise.all([
    releaseImportDAO.synced,
    webInterfaceImportDAO.synced,
    releaseWebInterfaceJunctionImportDAO.synced,
    browserMetricsImportDAO.synced,
    apiVelocityImportDAO.synced,
  ]).then(function() {
    logger.info('Loaded journaled data');
  });
}

//
// Do the import! First API data, then metrics data.
//

doImport(syncDatastoreData, loadJournaledData, [
  {
    sync: releaseSyncDAO,
    cache: releaseCacheDAO,
    import: releaseImportDAO,
    export: releaseExportDAO,
  },
  {
    sync: webInterfaceSyncDAO,
    cache: webInterfaceCacheDAO,
    import: webInterfaceImportDAO,
    export: webInterfaceExportDAO,
  },
  {
    sync: releaseWebInterfaceJunctionSyncDAO,
    cache: releaseWebInterfaceJunctionCacheDAO,
    import: releaseWebInterfaceJunctionImportDAO,
    export: releaseWebInterfaceJunctionExportDAO,
  },
  {
    sync: browserMetricsSyncDAO,
    cache: browserMetricsCacheDAO,
    import: browserMetricsImportDAO,
    export: browserMetricsExportDAO,
  },
  {
    sync: apiVelocitySyncDAO,
    cache: apiVelocityCacheDAO,
    import: apiVelocityImportDAO,
    export: apiVelocityExportDAO,
  },
]);
