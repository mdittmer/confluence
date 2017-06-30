// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'CompareSink',
  extends: 'foam.dao.ProxySink',

  properties: [
    {
      class: 'foam.dao.DAOProperty',
      name: 'dao'
    },
    {
      class: 'Boolean',
      name: 'newData'
    },
    {
      name: 'equals',
      value: foam.util.equals
    }
  ],

  methods: [
    function put(o) {
      this.dao.find(o).then(this.onFind.bind(this, o));
    }
  ],

  listeners: [
    function onFind(o1, o2) {
      if (!this.equals(o1, o2)) {
        this.newData = true;
        this.delegate.put(o1);
      }
    }
  ]
});
