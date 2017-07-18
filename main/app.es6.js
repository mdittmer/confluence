// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

var worker;
function runDedicatedWorker() {
  if (worker) return;
  worker = new Worker('worker.bundle.js');
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    try {
      navigator.serviceWorker.register('worker.bundle.js')
          .then(registration => {
            console.log('ServiceWorker registration successful with scope:',
                        registration.scope);
          }, error => {
            console.warn('ServiceWorker registration failed:', error);
            runDedicatedWorker();
          });
    } catch (error) {
      console.warn('ServiceWorker registration failed:', error);
      runDedicatedWorker();
    }
  });
} else {
  runDedicatedWorker();
}

require('materialize-css/dist/js/materialize.js');
require('materialize-css/dist/css/materialize.css');
require('angular');
require('angular-ui-router');

require('../lib/web_apis/release.es6.js');
require('../lib/web_apis/web_interface.es6.js');
require('../lib/web_apis/release_interface_relationship.es6.js');
require('../lib/client/api_matrix.es6.js');
require('../lib/client/api_confluence.es6.js');

let app = angular.module('confluence', ['ui.router']);

require('../lib/client/api_service.es6.js');
require('../lib/controller/api_catalog.es6.js');
require('../lib/controller/api_confluence.es6.js');
require('../lib/controller/default.es6.js');

app.config(function($stateProvider, $urlRouterProvider) {
  $stateProvider.state({
    name: 'home',
    url: '/',
    controller: 'defaultController',
    template: require('../static/view/home.html'),
  });

  $stateProvider.state({
    name: 'catalog',
    url: '/catalog',
    controller: 'catalogController',
    template: require('../static/view/api_catalog.html'),
    resolve: {
      apiPromises: function(api) {
        return Promise.all(api.promises);
      },
    },
  });

  $stateProvider.state({
    name: 'confluence',
    url: '/confluence',
    controller: 'confluenceController',
    template: require('../static/view/confluence.html'),
  });

  $urlRouterProvider.otherwise('/');
});
