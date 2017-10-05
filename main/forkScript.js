// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

//
// Same as foam2/src/foam/box/node/forkScript.js, but require() application
// code.
//

const fs = require('fs');
const path = require('path');

global.FOAM_FLAGS = {gcloud: true};
require(path.resolve(`${__dirname}/../node_modules/foam2/src/foam.js`));

require('../lib/confluence/aggressive_removal.es6.js');
require('../lib/confluence/api_velocity.es6.js');
require('../lib/confluence/browser_specific.es6.js');
require('../lib/confluence/failure_to_ship.es6.js');
require('../lib/datastore/datastore_container.es6.js');
require('../lib/sync_dao.es6.js');
require('../lib/web_apis/release.es6.js');
require('../lib/web_apis/release_interface_relationship.es6.js');
require('../lib/web_apis/web_interface.es6.js');
const pkg = org.chromium.apis.web;

const logger = foam.log.ConsoleLogger.create();
let credentials;
let ctx;
try {
  // Setup BaseDatastoreContainer for logging and authenticated Datastore
  // access.
  credentials = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../.local/credentials.json')));
  ctx = pkg.BaseDatastoreContainer.create({
    gcloudAuthEmail: credentials.client_email,
    gcloudAuthPrivateKey: credentials.private_key,
    gcloudProjectId: credentials.project_id,
    logger: logger,
  }).ctx;
} catch (e) {
  logger.warn('No Datastore credentails found');
  // Setup DAOContainer with logger and safe box context.
  ctx = foam.box.Context.create({
    unsafe: false,
    classWhitelist: require('../data/class_whitelist.json'),
  }, pkg.DAOContainer.create(null, foam.__context__.createSubContext({
    logger: logger,
  }))).__subContext__;
}

foam.box.node.ForkBox.CONNECT_TO_PARENT(ctx);
