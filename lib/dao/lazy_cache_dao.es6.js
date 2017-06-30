// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

require('./compare_sink.es6.js');

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'LazyCacheDAO',
  extends: 'foam.dao.ProxyDAO',

  documentation: `A lazy cache DAO that passes delegate results to sink before
      updating cache. Promise return values resolve with cached results or
      reject with delegate error when both cache and delegate reject. This is
      useful when a large result set comes over the network and the data should
      be delivered to the UI before paying the cost of storing the data in the
      cache.`,

  requires: [
    'foam.dao.ArraySink',
    'foam.dao.DAOSink',
    'org.chromium.apis.web.CompareSink',
  ],

  properties: [
    {
      name: 'cache',
      required: true
    },
    {
      name: 'defer',
      factory: function() {
        return function(f) { setTimeout(f, 0); };
      },
    },
  ],

  methods: [
    function find_(x, o) {
      var ret = undefined;
      var err = undefined;
      var self = this;
      return new Promise(function(resolve, reject) {
        self.cache.find_(x, o).then(function(v) {
          // Avoid duplicate resolve/reject.
          if (ret !== undefined || err !== undefined) return;
          resolve(ret = v);
        }, function(error) {
          // Avoid duplicate resolve/reject.
          if (ret !== undefined) return;
          // If delegate errored too, reject with delegate's error.
          if (err !== undefined) reject(err);
          else self.warn('Error on cache find; waiting for delegate.');
          err = error;
        });
        self.delegate.find_(x, o).then(function(v) {
          // Put to cache unless cache already returned the same value.
          if (!foam.util.equals(ret, v)) self.cache.put_(v);
          // Avoid duplicate resolve/reject.
          if (ret !== undefined || err !== undefined) return;
          resolve(ret = v);
        }, function(error) {
          // Avoid duplicate resolve/reject.
          if (ret !== undefined) return;
          // If cache errored too, reject with delegate's error.
          if (err !== undefined) reject(error);
          else self.warn('Error on delegate find; waiting for cache.');
          err = error;
        });
      });
    },
    function put_(x, o) {
      this.cache.put_(x, o);
      return this.delegate.put_(x, o).catch(function(error) {
        // Undo cache put and notify "reset" when delegate put fails.
        this.cache.remove_(x, o);
        this.on.reset.pub();
        throw error;
      }.bind(this));
    },
    function remove_(x, o) {
      this.cache.remove_(x, o);
      return this.delegate.remove_(x, o).catch(function(error) {
        // Undo cache remove and notify "reset" when delegate put fails.
        this.cache.put_(x, o);
        this.on.reset.pub();
        throw error;
      }.bind(this));
    },
    function select_(x, sink, skip, limit, order, predicate) {
      var cacheSink = this.CompareSink.create({
        dao: this.cache,
        delegate: this.DAOSink.create({ dao: this.cache })
      });
      this.delegate.select_(x, cacheSink, skip, limit, order, predicate)
          .then(function(compareSink) {
            // Notify "reset" only when new data was put to cache.
            if (compareSink.newData) this.on.reset.pub();
          }.bind(this));

      return this.cache.select_(x, sink, skip, limit, order, predicate);
    },
    function removeAll_(x, skip, limit, order, predicate) {
      this.delegate.removeAll_(x, skip, limit, order, predicate);
      return this.cache.removeAll_(x, skip, limit, order, predicate);
    },
  ],
});
