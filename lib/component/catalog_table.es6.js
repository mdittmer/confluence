// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

require('../foam_ng.es6.js');
require('../web_apis/web_interface.es6.js');

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'CatalogTableController',
  implements: ['foam.mlang.Expressions'],

  documentation: `FOAM component to encapsulate Angular
        catalogTableController.`,

  requires: [
    'org.chromium.apis.web.WebInterface',
  ],
  imports: [
    'webInterfaceDAO',
    'releaseWebInterfaceJunctionDAO',

    'ngScope',

    // From Angular scope:
    'releases',
    'releaseOptions',
    'numAvailable',
  ],
  exports: [
    'apis',
    'currentPage',
    'itemsPerPage',
    'apiCatalogMatrix',
  ],

  classes: [
    {
      name: 'MatrixSink',
      extends: 'foam.dao.AbstractSink',

      documentation: 'Construct and set API matrix consumed by table view.',

      imports: ['apiCatalogMatrix'],

      properties: [
        {
          name: 'matrix',
          factory: function() { return {}; },
        },
      ],

      methods: [
        function put(api) {
          console.log('MatrixSink.put', foam.json.objectify(api));
          const iName = api.interfaceName;
          const aName = api.apiName;
          let iface = this.matrix[iName] = this.matrix[iName] || {};
          let apiMap = iface[aName] = iface[aName] || {};
          apiMap[api.releaseKey] = true;
        },
      ],
    },
    {
      name: 'WindowSink',
      extends: 'foam.dao.AbstractSink',

      documentation: `Process a window of APIs that should be big enough
            to store roughly "itemsPerPage" APIs.

            The sink expects to recieve records from:
                currentPage * itemsPerPage - 1
            through:
                (currentPage + 1) * itemsPerPage + <some slack>

            More precisely, sink will keep all interfaces that have their
            *first* API in from:
                  currentPage * itemsPerPage
            through:
                (currentPage + 1) * itemsPerPage

            Relative to select()ed window, that is:
                [ foo#1, ..., foo#n, bar#1, ..., baz#i, ..., baz#n, quz#1, ... ]
                  ^           ^      ^           ^           ^      ^
                 (0)         (1)    (2)         (3)         (4)    (5)

                 (0) Last API known to be on previous page (except on page 0)
                 (1) Actual last API on previous page (except on page 0)
                 (2) First API on this page
                 (3) Canonical "end of this page" according to itemsPerPage
                 (4) Actual last API on this page
                 (5) First API that can be safely ignored in result set`,

      imports: [
        'apis',
        'currentPage',
        'itemsPerPage',
      ],

      properties: [
        {
          class: 'String',
          documentation: `First name encountered. Belongs to last API from
                previous page unless this is the first page.`,
          name: 'firstInterfaceName',
        },
        {
          class: 'String',
          documentation: 'Interface name from immediate previous put().',
          name: 'lastInterfaceName',
        },
        {
          class: 'Int',
          documentation: 'Counter: Each put() receives ith record.',
          name: 'i',
        },
        {
          class: 'FObjectArray',
          of: 'org.chromium.apis.web.WebInterface',
          documentation: `APIs that should be a part of this window's page.`,
          name: 'apis_',
        },
        {
          class: 'Boolean',
          documentation: `Indicator to check that APIs were accumulated in
                this window.`,
          name: 'done',
        },
      ],

      methods: [
        function put(api, sub) {
          console.log('WindowSink.put', foam.json.objectify(api));

          // (0) First put only.
          if (!this.firstInterfaceName)
            this.firstInterfaceName = api.interfaceName;

          // Now past (3); check for (5) to stop iterating.
          if (this.i > this.itemsPerPage &&
              api.interfaceName !== this.lastInterfaceName) {
            sub.detach();
            this.apis = this.apis_;
            this.done = true;
            return;
          }

          // If at or beyond (2), then keep API.
          if (this.currentPage === 0 ||
              api.interfaceName !== this.firstInterfaceName) {
            this.apis_.push(api.id);
          }

          // Bookkeeping for detecting (5).
          this.lastInterfaceName = api.interfaceName;
          this.i++;
        },
        function eof() {
          foam.assert(
              this.done, 'CatalogTableController: Paging window too small');
        },
      ],
    },
  ],

  properties: [
    {
      class: 'org.chromium.apis.web.NGScopeProperty',
      name: 'apiCatalogMatrix',
      factory: function() { return {}; },
    },
    {
      class: 'org.chromium.apis.web.NGScopeProperty',
      name: 'apis',
      factory: function() { return []; },
    },
    {
      class: 'org.chromium.apis.web.NGScopeProperty',
      name: 'showRows',
      factory: function() { return {}; },
    },
    {
      class: 'org.chromium.apis.web.NGScopeProperty',
      name: 'currentPage',
      factory: function() { return 0; },
    },
    {
      class: 'org.chromium.apis.web.NGScopeProperty',
      name: 'itemsPerPage',
      factory: function() { return 50; },
    },
    {
      class: 'org.chromium.apis.web.NGScopeProperty',
      name: 'expandAll',
      factory: function() { return true; },
    },
  ],

  methods: [
    function init() {
      console.log('CatalogTableController.init');
      this.webInterfaceDAO.on.reset.sub(this.onWebInterfaceDAOReset);
      this.releaseWebInterfaceJunctionDAO.on.reset.sub(this.computeMatrix);

      this.releases$.sub(this.computeMatrix);
      this.apis$.sub(this.computeMatrix);
      this.currentPage$.sub(this.computeMatrix);

      // If cache is fully populated, DAO may never reset. Simulate
      // reset on init.
      this.onWebInterfaceDAOReset();
    },
  ],

  listeners: [
    {
      name: 'onWebInterfaceDAOReset',
      isMerged: true,
      mergeDelay: 10,
      code: function() {
        console.log('CatalogTableController.onWebInterfaceDAOReset');
        // Reset rows-to-show-API-names-on on new page.
        this.showRows = {};

        // Fetch a window of Release<-->API data that corresponds to the new
        // current page.
        let dao = this.webInterfaceDAO.orderBy(this.WebInterface.ID);
        if (this.currentPage > 0) {
          // Peek back one record to establish last interface on previous
          // page.
          dao = dao.skip(this.currentPage * this.itemsPerPage - 1);
        }

        // TODO(markdittmer): How much space do we need?
        dao.limit(1 + this.itemsPerPage + 100)
            .select(this.WindowSink.create()).then(function() {
              console.log('CatalogTableController.onWebInterfaceDAOReset done');
            });
      },
    },
    {
      name: 'computeMatrix',
      isMerged: true,
      mergeDelay: 10,
      code: function() {
        console.log('CatalogTableController.computeMatrix');
        if (this.apis.length === 0) {
          console.log('CatalogTableController.computeMatrix: no APIs');
          return;
        }

        var newMatrix = {};
        // Select over each release to gather its interfaces into common
        // matrix, "newMatrix".
        Promise.all(this.releases.map(release => release.interfaces.dao
            .where(this.IN(this.WebInterface.ID, this.apis))
            .select(this.MatrixSink.create({matrix: newMatrix}))))
            // Trigger set (and Angular scope update) on apiCatalogMatrix.
            .then(() => {
              console.log('CatalogTableController.computeMatrix: set', newMatrix);
              this.apiCatalogMatrix = newMatrix;
            });
      },
    },
    {
      class: 'org.chromium.apis.web.NGScopeListener',
      name: 'showCatalog',
      code: function(interfaceName) {
        this.showRows[interfaceName] = !this.showRows[interfaceName];
        this.ngScope.$apply();
      },
    },
    {
      class: 'org.chromium.apis.web.NGScopeListener',
      name: 'removeRelease',
      code: function($event, release) {
        // When remove release button clicked, notify
        // parent component to delete this release from release list.
        $event.stopPropagation();
        this.onDeleteRelease(release);
      },
    },
    {
      class: 'org.chromium.apis.web.NGScopeListener',
      name: 'setPage',
      documentation: 'Set page when navigate to new page.',
      code: function(p) {
        // TODO(markdittmer): Assert valid value.
        this.currentPage = p;
      },
    },
    {
      class: 'org.chromium.apis.web.NGScopeListener',
      name: 'downloadCSV',
      documentation: `Download csv from catalogMatrix. This matrix is filtered
          by release options and search keyword (if exists).`,
      code: function(p) {
        // TODO(markdittmer): Gather the rest of the matrix. Controller
        // currently limits matrix to current page.

        // Old implementation:
        // let filename = 'result.csv';
        // let releaseKeys = ctlr.releases.map(release => release.releaseKey);
        // let csv = apiMatrix.matrixToCSV(releaseKeys,
        //   $scope.apiCatalogMatrix);
        // if (csv === null) return;
        // if (!csv.match(/^data:text\/csv/i)) {
        //   csv = 'data:text/csv;charset=utf-8,' + csv;
        // }
        // let data = encodeURI(csv);
        // let link = document.createElement('a');
        // link.setAttribute('href', data);
        // link.setAttribute('download', filename);
        // link.click();
      },
    },
    {
      class: 'org.chromium.apis.web.NGScopeListener',
      documentation: 'Get searched result from apiMatrix and update view.',
      name: 'search',
      code: function($event) {
        // TODO(markdittmer): Implement filtering in computeMatrix().

        $event.preventDefault();
        // Old implementation:
        // let releaseKeys = getReleaseKeys(ctrl.releases);
        // let key = $scope.searchKey;
        // apiMatrix.toMatrix(releaseKeys, {
        //   searchKey: key,
        //   releaseOptions: ctrl.releaseOptions,
        //   numAvailable: ctrl.numAvailable,
        // }).then(displayMatrix);
      },
    },
  ],
});

require('angular');

angular.module('confluence').component('apiCatalogTable', {
  template: require('../../static/component/catalog_table.html'),
  controller: [
    '$scope',
    'api',
    function catalogTableController($scope, api) {
      // TODO(markdittmer): Angular bindings. How do they work?
      const ctx = $scope.$parent.catalogCtx;

      const ctlr = foam.lookup('org.chromium.apis.web.CatalogTableController')
      // Use CatalogController FOAM context.
          .create(null, ctx);

      // TODO(markdittmer): Angular bindings. How do they work?
      // const onDeleteRelease = this.onDeleteRelease.bind(this);
      // ctlr.onDeleteRelease = onDeleteRelease;
    },
  ],
  bindings: {
    // FOAM context.
    catalogCtx: '<',
    // release is an array of releases.
    releases: '<',
    // releaseOptions is an optional JSON of form {releaseKey: Boolean, ...}
    // The result matrix will be filtered based on the options.
    releaseOptions: '<',
    // Function to handle delete release action if ableToDeleteRelease is true.
    onDeleteRelease: '&',
    // numAvailable is an optional Integer or Integer array. When set, only
    // APIs supported by numAvailable releases are returned. When numAvailable
    // is an array, any integer in it is a valid number of supporting releases.
    numAvailable: '<',
  },
});
