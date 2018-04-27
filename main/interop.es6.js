// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');
const url = require('url');

require('foam2');

require('../lib/property.es6.js');

require('../lib/grid_dao.es6.js');
require('../lib/http_json_dao.es6.js');
require('../lib/json_dao_container.es6.js');
require('../lib/local_json_dao.es6.js');
require('../lib/parse/expressions.es6.js')
require('../lib/web_apis/api_compat_data.es6.js');
require('../lib/web_apis/relational_to_compat.es6.js');
require('../lib/web_apis/release.es6.js');
require('../lib/web_apis/release_interface_relationship.es6.js');
require('../lib/web_apis/web_interface.es6.js');
const pkg = org.chromium.apis.web;

const log = function() {
  return console.log.apply(console, arguments);
}

const foam2str = function(f) {
  return JSON.stringify(foam.json.objectify(f), null, 2);
}

const parser = foam.json.Parser.create({
  strict: true,
});

const releasesJSON = fs.readFileSync(`${__dirname}/../data/json/org.chromium.apis.web.Release.json`).toString();
const releaseDateComparator = (l, r) => l.releaseDate.getTime() - r.releaseDate.getTime();
const releases = parser.parseClassFromString(releasesJSON, pkg.Release).filter(r => !r.isMobile)
    .filter(r => r.browserName === 'Safari' || r.osName === 'Windows')
    .sort(releaseDateComparator);

const clsJSON = fs.readFileSync(`${__dirname}/../data/json/class:org.chromium.apis.web.generated.CompatData.json`).toString();
const model = parser.parseClassFromString(clsJSON, foam.core.Model);
model.validate();
const cls = model.buildClass();
cls.validate();
foam.register(cls);
foam.package.registerClass(cls);

const dataJSON = fs.readFileSync(`${__dirname}/../data/json/org.chromium.apis.web.generated.CompatData.json`).toString();
const data = parser.parseClassFromString(dataJSON, cls);
const dataDAO = foam.dao.MDAO.create({of: cls});
data.forEach(datum => dataDAO.put(datum));

let rels = {};
let latestRel;
const numReleases = () => {
  return Object.keys(rels).length;
}
const relsArray = () => {
  return Object.keys(rels).map(key => rels[key]);
};

const initRels = () => {
  let i;
  for (i = 0; i < releases.length && numReleases() < 3; i++) {
    rels[releases[i].browserName] = releases[i];
    latestRel = releases[i];
    log('initRels', 'iter', foam2str(latestRel));
  }
  log('initRels', 'selected', foam2str(rels));
  i--;
  return i;
};

const incRels = (i) => {
  i++;
  if (i >= releases.length) {
    log('incRels', 'STOP');
    return i;
  }

  rels[releases[i].browserName] = releases[i];
  latestRel = releases[i];
  log('incRels', foam2str(latestRel));
  return i;
};

const getReleaseProperties = () => {
  const arr = relsArray();
  return cls.getAxiomsByClass(org.chromium.apis.web.CompatProperty)
      .filter(p => arr.some(r => foam.util.equals(p.release, r)));
}

const E = foam.mlang.ExpressionsSingleton.create();

const getReleaseQuery = (count) => {
  const props = getReleaseProperties();
  foam.assert(props.length === relsArray().length, 'Incorrect number of compat properties');
  return E.EQ(E.ARRAY_COUNT(E.SEQ.apply(E, props), E.TRUTHY()), count);
};

let output = {
  releases: foam.json.objectify(releases),
  data: [],
};
var dataOut = output.data;

const getCounts = (async function() {
  const num = relsArray().length + 1;
  let counts = [];
  for (let i = 0; i < num; i++) {
    const query = getReleaseQuery(i);
    const sink = await dataDAO.where(query).select(E.COUNT());
    counts.push(sink.value);
  }
  return counts;
});

const fillData = (async function() {
  for (let i = initRels(); i < releases.length; i = incRels(i)) {
    const date = latestRel.releaseDate;
    const counts = await getCounts();
    dataOut.push({date, counts});
  }

  return dataOut;
});

const saveDataJSON = () => {
  fs.writeFileSync(`${__dirname}/../data/interop.json`, JSON.stringify(output, null, 2));
};

const saveDataCSV = () => {
  let str = '"Date","0 Browsers","1 Browsers","2 Browsers","3 Browsers","4 Browsers","..."\n';
  dataOut.forEach(({date, counts}) => {
    str += `"${date.toISOString()}",${counts.join(',')}\n`;
  });
  fs.writeFileSync(`${__dirname}/../data/interop.csv`, str);
};

fillData().then(saveDataJSON).then(saveDataCSV).then(() => log('DONE'));
