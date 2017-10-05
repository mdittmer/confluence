// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

const argv = require('process').argv;

const clsName = argv[2];
if (!clsName)
  throw new Error('Expected parameter: Class name under org.chromium.apis.web');
let order = argv[3];

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
const pkg = org.chromium.apis.web;

const cls = pkg[clsName];
if (!cls)
  throw new Error(`"${clsName}" not found under org.chromium.apis.web`);
if (order && !foam.core.Property.isInstance(cls[order]))
  throw new Error(`"${clsName}.${order}" is not a property`);

let dao = foam.dao.JDAO.create({
  of: cls,
  journal: foam.dao.NodeFileJournal.create({
    of: cls,
    fd: fs.openSync(
        `${__dirname}/../data/journal/org.chromium.apis.web.${clsName}-journal.js`,
        'r'),
  }),
  delegate: foam.dao.MDAO.create({of: cls}),
});
if (order) dao = dao.orderBy(cls[order]);
dao.select().then(arraySink => fs.writeFileSync(
    `${__dirname}/../data/json/${cls.id}.json`,
    foam.json.Compact.stringify(arraySink.array, cls)));
