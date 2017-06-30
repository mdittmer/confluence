// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

require('../confluence/metric_computer.es6.js');
require('../component/catalog_table.es6.js');
require('../foam_ng.es6.js');

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'CatalogController',

  documentation: 'FOAM component to encapsulate Angular catalogController.',

  requires: [
    'org.chromium.apis.web.MetricComputer',
  ],
  imports: [
    'ngScope',
    'releaseDAO',
  ],
  exports: [
    'releases',
    'releaseOptions',
    'numAvailable',
    'releaseGroups',
  ],

  classes: [
    {
      name: 'ReleaseGroupsSink',
      extends: 'foam.dao.AbstractSink',

      imports: [
        'ngScope',
        'releaseGroups',
      ],

      methods: [
        function put(release) {
          console.log('ReleaseGroupsSink.put', foam.json.objectify(release));
          var name = release.browserName;
          var version = release.version;
          var group = this.releaseGroups[name] = this.releaseGroups[name] || {};
          var versions = group[version] = group[version] || [];
          versions.push(release);
          versions.sort();
          this.updateScope();
        },
      ],

      listeners: [
        {
          name: 'updateScope',
          isMerged: true,
          mergeDelay: 150,
          code: function() { this.ngScope.$apply(); },
        },
      ],
    },
  ],

  properties: [
    {
      class: 'FObjectProperty',
      of: 'org.chromium.apis.web.MetricComputer',
      documentation: `Instance for accessing
            "getLatestReleaseFromEachBrowserAtDate()"`,
      name: 'computer',
      factory: function() { return this.MetricComputer.create(); },
    },
    {
      class: 'org.chromium.apis.web.NGScopeProperty',
      name: 'showTab',
      factory: function() { return 0; },
    },
    {
      class: 'org.chromium.apis.web.NGScopeProperty',
      name: 'filteredViews',
      factory: function() { return []; },
    },
    {
      class: 'org.chromium.apis.web.NGScopeProperty',
      name: 'expandReleaseDropdown',
      factory: function() { return {}; },
    },
    {
      class: 'org.chromium.apis.web.NGScopeProperty',
      name: 'releaseGroups',
      factory: function() { return {}; },
    },
    {
      class: 'org.chromium.apis.web.NGScopeProperty',
      name: 'releases',
      factory: function() { return []; },
    },
    {
      class: 'org.chromium.apis.web.NGScopeProperty',
      name: 'releaseOptions',
    },
    {
      class: 'org.chromium.apis.web.NGScopeProperty',
      name: 'numAvailable',
    },
  ],

  methods: [
    function init() {
      console.log('CatalogController.init');
      this.releaseDAO.on.reset.sub(this.onReleaseDAOReset);
      this.releaseDAO.pipe_(this.__subContext__,
                            this.ReleaseGroupsSink.create());
      this.initReleases();
    },
    function initReleases() {
      console.log('CatalogController.initReleases');
      if (this.releases.length > 0) return;
      console.log('CatalogController.initReleases go');
      this.computer.getLatestReleaseFromEachBrowserAtDate(new Date())
          .then(releases => {
            if (this.releases.length === 0) {
              console.log('CatalogController.initReleases set', releases);
              this.releases = releases;
            } else {
              console.log('CatalogController.initReleases second check: no-go');
            }
          });
    },
    function alertError(errorMsg) {
      Materialize.toast(errorMsg, 4000);
    },
  ],

  listeners: [
    {
      name: 'onReleaseDAOReset',
      isMerged: true,
      mergeDelay: 10,
      code: function() {
        console.log('CatalogController.onReleaseDAOReset');
        this.initReleases();
      },
    },
    {
      class: 'org.chromium.apis.web.NGScopeListener',
      name: 'expandReleaseList',
      code: function($event, release, version) {
        // Stop propagation to stop dropdown list disapearing.
        $event.stopPropagation();
        let $scope = this.ngScope;
        if (version) {
          if ($scope.expandReleaseDropdown[release].hasOwnProperty(version)) {
            delete $scope.expandReleaseDropdown[release][version];
          } else {
            $scope.expandReleaseDropdown[release][version] = true;
          }
          return;
        }
        if (release) {
          if ($scope.expandReleaseDropdown.hasOwnProperty(release)) {
            delete $scope.expandReleaseDropdown[release];
          } else {
            $scope.expandReleaseDropdown[release] = {};
          }
        }
      },
    },
    {
      class: 'org.chromium.apis.web.NGScopeListener',
      name: 'addRelease',
      code: function(release) {
        let $scope = this.ngScope;
        let releaseKey = release.releaseKey;
        let releaseKeys = $scope.releases
            .map((release) => release.releaseKey);
        if (releaseKeys.indexOf(releaseKey) >= 0) {
          alertError('This release is already selected.');
          return;
        }
        // Array.push does not trigger Angular component's $onChanges listener.
        // Need to create a new Array.
        $scope.releases = $scope.releases.concat([release]);
      },
    },
    {
      class: 'org.chromium.apis.web.NGScopeListener',
      name: 'removeRelease',
      code: function(release) {
        let $scope = this.ngScope;
        let releaseKey = release.releaseKey;
        let releaseKeys = $scope.releases
            .map((release) => release.releaseKey);
        let removeIndex = releaseKeys.indexOf(releaseKey);
        if (removeIndex === -1) return;
        $scope.releases.splice(removeIndex, 1);
        // Same as above, create a new array to trigger $onChanges listerner.
        $scope.releases = $scope.releases.slice();
      },
    },
  ]
});

require('angular');

angular.module('confluence').controller(
    'catalogController',
    [
      '$scope',
      'api',
      function catalogController($scope, api) {
        // Activate dropdown and tabs.
        $('.add-release-dropdown').dropdown();
        $('ul#view-tabs').tabs();

        const ctx = api.createSubContext({
          ngScope: $scope,
        });
        const ctlr = foam.lookup('org.chromium.apis.web.CatalogController')
            .create(null, ctx);
        // Allow catalogTableControllers to be instantiated in CatalogController
        // FOAM context.
        $scope.catalogCtx = ctlr.__subContext__;
      }]);
