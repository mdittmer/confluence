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
require('../lib/confluence/api_velocity_data.es6.js');
require('../lib/confluence/browser_metric_data.es6.js');
require('../lib/confluence/failure_to_ship.es6.js');
require('../lib/confluence/set_ops.es6.js');
require('../lib/dao_container.es6.js');
require('../lib/datastore/datastore_container.es6.js');
require('../lib/web_apis/release.es6.js');
require('../lib/web_apis/release_interface_relationship.es6.js');
require('../lib/web_apis/web_interface.es6.js');
require('../lib/web_catalog/object_graph_importer.es6.js');
const pkg = org.chromium.apis.web;

const logger = foam.log.ConsoleLogger.create();

function getLocalDAO(name, delegate, ctx) {
  return foam.dao.JDAO.create({
    of: delegate.of,
    delegate: delegate,
    journal: foam.dao.NodeFileJournal.create({
      of: delegate.cls,
      fd: fs.openSync(
          path.resolve(__dirname, `../data/${name}-journal.js`),
          // Truncate journal.
          'w+'),
    }, ctx),
  }, ctx);
}

const ctx = pkg.DAOContainer.create({
  releaseDAO: foam.dao.MDAO.create({of: pkg.Release}),
  webInterfaceDAO: foam.dao.MDAO.create({of: pkg.WebInterface}),
  releaseWebInterfaceJunctionDAO: foam.dao.MDAO.create({
    of: pkg.ReleaseWebInterfaceJunction,
  }),
  browserMetricsDAO: foam.dao.MDAO.create({of: pkg.BrowserMetricData}),
  apiVelocityDAO: foam.dao.MDAO.create({of: pkg.ApiVelocityData}),
}, foam.__context__.createSubContext({
  logger: logger,
}));

const importer = pkg.ObjectGraphImporter.create({
  objectGraphPath: path.resolve(__dirname, '../data/og'),
}, ctx);
const junctionDAO = ctx.releaseWebInterfaceJunctionDAO;

ctx.releaseDAO = getLocalDAO(pkg.Release.id, ctx.releaseDAO, ctx);
ctx.webInterfaceDAO = getLocalDAO(
    pkg.WebInterface.id, ctx.webInterfaceDAO, ctx);
ctx.releaseWebInterfaceJunctionDAO = getLocalDAO(
    pkg.WebInterface.id, ctx.releaseWebInterfaceJunctionDAO, ctx);
ctx.apiVelocityDAO = getLocalDAO(
    pkg.ApiVelocityData.id, ctx.apiVelocityDAO, ctx);
ctx.browserMetricsDAO = getLocalDAO(
    pkg.BrowserMetricData.id, ctx.browserMetricsDAO, ctx);

logger.info('Adding junction DAO indices');
junctionDAO.addPropertyIndex(
    pkg.ReleaseWebInterfaceJunction.SOURCE_ID);
junctionDAO.addPropertyIndex(
    pkg.ReleaseWebInterfaceJunction.TARGET_ID);
junctionDAO.addPropertyIndex(
    pkg.ReleaseWebInterfaceJunction.SOURCE_ID,
    pkg.ReleaseWebInterfaceJunction.TARGET_ID);
logger.info('Added junction DAO indices');

logger.info('Importing API data');
importer.import().then(function() {
  logger.info('Waiting for API data journals to settle');
  return Promise.all([
    ctx.releaseDAO.synced,
    ctx.webInterfaceDAO.synced,
    ctx.releaseWebInterfaceJunctionDAO.synced,
  ]);
}).then(function() {
  logger.info('API data imported');

  logger.info('Computing API metrics');
  return Promise.all([
    pkg.AggressiveRemoval.create(null, ctx).run(),
    pkg.BrowserSpecific.create(null, ctx).run(),
    pkg.FailureToShip.create(null, ctx).run(),
    pkg.ApiVelocity.create(null, ctx).run(),
  ]);
}).then(function() {
  logger.info('Waiting for API metrics journals to settle');
  return Promise.all([
    ctx.browserMetricsSyncDAO.synced,
    ctx.apiVelocitySyncDAO.synced,
  ]);
}).then(function() {
    logger.info('Computed API metrics');
});
