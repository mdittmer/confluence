// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

require('../web_apis/api_importer.es6.js');
require('../web_apis/release.es6.js');
require('../web_apis/release_interface_relationship.es6.js');
require('../web_apis/web_interface.es6.js');
require('./api_extractor.es6.js');

const objectGraph = require('object-graph-js').ObjectGraph;
const fs = require('fs');
const path = require('path');

foam.CLASS({
  name: 'ObjectGraphImporter',
  package: 'org.chromium.apis.web',

  documentation: `Object graph importer handles importing releases' APIs from
      object graph files.`,

  requires: [
    'com.google.cloud.datastore.DatastoreDAO',
    'foam.dao.ArrayDAO',
    'foam.dao.ArraySink',
    'foam.mlang.ExpressionsSingleton',
    'org.chromium.apis.web.ApiExtractor',
    'org.chromium.apis.web.ApiImporter',
    'org.chromium.apis.web.RateLimitedDAO',
    'org.chromium.apis.web.Release',
    'org.chromium.apis.web.ReleaseWebInterfaceJunction',
    'org.chromium.apis.web.WebInterface',
  ],
  imports: ['info'],

  properties: [
    {
      name: 'apiExtractor',
      documentation: `Extracts interface catalog from object
          graph object.`,
      factory: function() {
        return this.ApiExtractor.create();
      },
    },
    {
      name: 'apiImporter',
      documentation: 'Imports interface catalog to DAO with rateLimiter.',
      factory: function() { return this.ApiImporter.create(); },
    },
    {
      name: 'versionHistory',
      documentation: `Browser release version history of the form:
          {<browserName>: {<browserVersion>: <releaseDateString>}}`,
      required: true,
      final: true,
    },
    {
      class: 'String',
      name: 'objectGraphPath',
      documentation: `The path to the directory containing object
          graph files. All files with name starting with "window_"
          are loaded as object graph files in this directory. Directories
          or files not starting with "window_" are ignored.`,
      required: true,
      final: true,
    },
    {
      class: 'String',
      name: 'projectId',
      documentation: `This project's id in Google Cloud Platform.`,
      required: true,
      final: true,
    },
    {
      class: 'String',
      name: 'protocol',
      documentation: `Protocol for connecting to the datastore.
          Default value is "https".`,
      value: 'https',
    },
    {
      class: 'String',
      name: 'host',
      documentation: `Hostname part of Datastore REST API URL.
          Default host is "datastore.googleapis.com".`,
      value: 'datastore.googleapis.com',
    },
    {
      class: 'Int',
      name: 'port',
      documentation: `Port for connecting to Datastore.
          default port is 443.`,
      value: 443,
    },
  ],
  methods: [
    {
      name: 'import',
      documentation: `Reads object graph files from objectGraphPath
          and extract web interfaces and import it to cloudstoreDAO
          using apiImporter.`,
      code: function() {
        const self = this;
        const dir = self.objectGraphPath;
        return self.getObjectGraphFiles().then(function(files) {
          let promise = Promise.resolve();
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const releaseInfo = file.slice(0, -5).split('_');
            // All Object Graph files' filename starts with "window_".
            self.info(`ObjectGraphImporter: read og file: ${file}`);
            const bName = releaseInfo[1];
            const bVersion = releaseInfo[2];
            const osName = releaseInfo[3];
            const osVersion = releaseInfo[4];
            promise = promise.then(function() {
              self.info(`ObjectGraphImporter: importing file: ${file}`);
              return self.apiImporter.import(
                  bName, bVersion, osName, osVersion,
                  self.apiExtractor.extractWebCatalog(
                      objectGraph.fromJSON(JSON.parse(fs.readFileSync(
                          `${dir}/${file}`)))));
            }).then(function() {
              self.info(`ObjectGraphImporter: imported file: ${file}`);
            });
          }
          return promise;
        });
      },
    },
    {
      name: 'getObjectGraphFiles',
      documentation: `Use "versionHistory" property to asynchronously compute
          the JSON file names in the order they are to be imported. The order is
          as follows:

          (1) A release of latest version of each browser;
          (2) A release of other versions in reverse chronological order;
          (3) Other releases of these browser versions, cycling through
              versions in the same order as (1), (2).

          NOTE: IE versions are currently excluded.`,
      code: function() {
        const E = this.ExpressionsSingleton.create();
        const versionMap = this.versionHistory;
        const dir = this.objectGraphPath;
        let releases = this.ArrayDAO.create();
        for (let browserName in versionMap) {
          for (let browserVersion in versionMap[browserName]) {
            const releaseDate =
                new Date(versionMap[browserName][browserVersion]);
            releases.put(this.Release.create({
              browserName,
              browserVersion,
              releaseDate,
            }));
          }
        }
        releases = releases.where(E.NEQ(this.Release.BROWSER_NAME, 'IE'))
            .orderBy(E.DESC(this.Release.RELEASE_DATE));

        let firstReleases = [];
        let restReleases = [];
        return releases.select(E.GROUP_BY(this.Release.BROWSER_NAME,
                                          this.ArraySink.create()))
            .then(function(sink) {
              const groups = sink.groups;
              for (let browserName in groups) {
                firstReleases.push(groups[browserName].array[0]);
              }
            }).then(function() {
              return releases.select();
            }).then(function(sink) {
              restReleases = sink.array
                  .filter(rls => firstReleases.indexOf(rls) === -1);
            }).then(function() {
              // Get regular expressions for browser versions.
              const releaseList = firstReleases.concat(restReleases);
              const regExps = releaseList.map(rls => new RegExp(`window_${rls.browserName}_${rls.browserVersion}[^_]*_[^_]*_[^_]*[.]json$`))

              // Get a list-of-lists of browser version releases, with the inner
              // list ordered with Windows releases at the end.
              const files = require('fs').readdirSync(dir);
              const fileLists =
                  regExps.map(re => files.filter(f => f.match(re)))
                  .map(fileList => fileList.sort(function(a, b) {
                    const aIsWindows = a.indexOf('Windows' !== -1);
                    const bIsWindows = b.indexOf('Windows' !== -1);
                    if (aIsWindows === bIsWindows) return 0;
                    else if (aIsWindows) return 1;
                    else return -1;
                  }));

              // Cycle through list-of-lists, popping off one release at a time
              // until all releases have been consumed.
              let moreFiles = true;
              let fileList = [];
              while (moreFiles) {
                moreFiles = false;
                for (let i = 0; i < fileLists.length; i++) {
                  if (fileLists[i].length === 0) continue;
                  fileList.push(fileLists[i].pop());
                  moreFiles = moreFiles || fileLists[i].length > 0;
                }
              }
              return fileList;
            });
      }
    }
  ],
});
