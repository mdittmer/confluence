// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'NGScopeBinding',

  documentation: 'An entity bound to an Angular scope.',

  properties: [
    {
      class: 'String',
      documentation: `Property name for accessing Angular scope on
          property-holding instance.`,
      name: 'ngScopePropName',
      value: 'ngScope',
    },
  ],
});

// Property for one-way FOAM --> Angular scope binding.
foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'NGScopeProperty',
  extends: 'foam.core.Property',
  implements: ['org.chromium.apis.web.NGScopeBinding'],

  documentation: 'A property bound to an Angular scope.',

  properties: [
    {
      name: 'factory',
      value: function(prop) {
        return this[prop.ngScopePropName][prop.name];
      },
    },
    {
      name: 'postSet',
      value: function(old, nu, prop) {
        this[prop.ngScopePropName][prop.name] = nu;
      },
    },
  ],

  methods: [
    function initObject(o) {
      // Trigger lazy factory.
      o[this.name];
    },
  ],
});

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'NGScopeListener',
  extends: 'foam.core.Listener',
  implements: ['org.chromium.apis.web.NGScopeBinding'],

  documentation: 'A listener bound to an Angular scope.',

  methods: [
    function initObject(o) {
      // Copy listener to scope.
      o[this.ngScopePropName][this.name] = o[this.name];
    },
  ],
});
