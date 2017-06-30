// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'ContextualizingDAO',
  extends: 'foam.dao.ProxyDAO',

  documentation: `Contextualize output objects in this DAO's context.`,

  classes: [
    {
      name: 'ContextualizingSink',
      extends: 'foam.dao.ProxySink',

      methods: [
        function put(obj, sub) {
          return this.delegate.put(obj ? obj.clone(this) : obj, sub);
        },
      ],
    },
  ],

  methods: [
    function find_(x, id) {
      var self = this;
      return self.delegate.find_(x, id).then(function(obj) {
        return obj ? obj.clone(self) : obj;
      });
    },
    function put_(x, o) {
      return self.delegate.put_(x, o).then(function(obj) {
        return obj ? obj.clone(self) : obj;
      });
    },
    function remove_(x, o) {
      return self.delegate.remove_(x, o).then(function(obj) {
        return obj ? obj.clone(self) : obj;
      });
    },
    function select_(x, sink, skip, limit, order, predicate) {
      return this.delegate.select_(
          x, this.ContextualizingSink.create({delegate: sink}), skip, limit,
          order, predicate).then(ctxSink => ctxSink.delegate);
    },
  ],
});
