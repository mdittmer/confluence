// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

foam.CLASS({
  name: 'ConfluenceCacheDAO',
  package: 'org.chromium.apis.web',
  extends: 'foam.dao.ProxyDAO',

  documentation: `A caching DAO that relies on specific assumptions valid for
      confluence release/API junction data. Assumptions:

          (1) The DAO is read-only (custom put()/remove()/removeAll() not
              implemented);
          (2) Preloading all data is too expensive so cache lazily;
          (3) Data change rarely so cache never expires;
          (4) Cache (delegate) is implements DAO operations synchronously (e.g.,
              MDAO);
          (5) Returning results before they have been cached will not introduce
              unacceptable race conditions in application logic.`,

  requires: [
    'foam.dao.ArraySink',
  ],

  properties: [
    {
      class: 'foam.dao.DAOProperty',
      documentation: 'Remote DAO; authoritative data source.',
      name: 'remote',
    },
    {
      name: 'queries_',
      documentation: `Map of completed queries. This is used to debounce
          clients that re-issue queries when the DAO publishes on.reset.`,
      factory: function() { return {}; },
    },
  ],

  methods: [
    {
      name: 'getCacheKey',
      documentation: 'Get a unique String key for a query.',
      code: function (skip, limit, order, predicate) {
        return `${skip || 0},${limit || 0},${order ? order.toString() : null},${predicate ? predicate.toString() : null}`;
      },
    },
    function select_(ctx, sink, skip, limit, order, predicate) {
      sink = sink || this.ArraySink.create(null, ctx);
      var cacheKey = this.getCacheKey(skip, limit, order, predicate);
      if (this.queries_[cacheKey]) {
        return this.selectFromCache_(cacheKey, ctx, sink, skip, limit, order,
                                     predicate);
      }

      this.remote.select_(ctx, null, skip, limit, order, predicate)
          .then(this.onRemoteSelect.bind(this, cacheKey));
      return this.delegate.select_(ctx, sink, skip, limit, order, predicate);
    },
    function find_(ctx, objOrId) {
      const remotePromise = this.remote.find_(ctx, objOrId);
      const delegatePromise = this.remote.find_(ctx, objOrId);
      Promise.all([remotePromise, delegatePromise])
          .then(this.onBothFind.bind(this, ctx, objOrId));
      return delegatePromise
          .then(this.onDelegateFind.bind(this, ctx, objOrId, remotePromise));
    },
    {
      name: 'selectFromCache_',
      documentation: `Select cached data. Either replay an array of results or
          query delegate that has been filled with the result set already.`,
      code: function(cacheKey, ctx, sink, skip, limit, order, predicate) {
        var cached = this.queries_[cacheKey];

        // If cache has been filled, then cached is true. Otherwise, it is an
        // Array of results.
        if (!foam.Array.isInstance(cached)) {
          return this.delegate.select_(ctx, sink, skip, limit, order,
                                       predicate);
        }

        // TODO(markdittmer): Pass detachable for control flow.
        for (var i = 0; i < cached.length; i++) {
          sink.put(cached[i]);
        }
        sink.eof();
        return Promise.resolve(sink);
      },
    },
  ],

  listeners: [
    {
      name: 'onRemoteSelect',
      documentation: `Respond to data arriving from remote. Temporarily store
          data array and notify clients that data have changed.`,
      code: function(cacheKey, arraySink) {
        this.queries_[cacheKey] = arraySink.array;
        this.on.reset.pub();
        setTimeout(this.onSelectResult.bind(this, cacheKey), 250);
      },
    },
    {
      name: 'onSelectResult',
      code: function(cacheKey) {
        var cached = this.queries_[cacheKey];

        // If cache has been filled, then cached is true. Otherwise, it is an
        // Array of results.
        if (!foam.Array.isInstance(cached)) return;

        // TODO(markdittmer): Do this in batches?
        for (var i = 0; i < cached.length; i++) {
          // Assume delegate puts synchronously and Promise-tracking is
          // unnecessary.
          this.delegate.put(cached[i]);
        }
        this.queries_[cacheKey] = true;
      },
    },
    {
      name: 'onDelegateFind',
      documentation: `Respond to this.delegate.find(). If not found, wait for
          remote response.`,
      code: function(ctx, objOrId, remotePromise, foundInDelegate) {
        return foundInDelegate === null ? remotePromise : foundInDelegate;
      },
    },
    {
      name: 'onBothFind',
      documentation: `Respond to this.delegate.find() + this.remote.find() by
          (maybe) updating cache. This does not produce the this.find() result;
          onDelegateFind() does.`,
      code: function(ctx, objOrId, foundInRemoteAndDelegate) {
        const foundInRemote = foundInRemoteAndDelegate[0];
        const foundInDelegate = foundInRemoteAndDelegate[1];
        if (!foam.util.equals(foundInRemote, foundInDelegate)) {
          if (foundInRemote === null) {
            this.delegate.remove_(ctx, objOrId);
          } else {
            this.delegate.put_(ctx, foundInRemote);
          }
          this.onFindReset();
        }
        return foundInRemote;
      },
    },
    {
      name: 'onFindReset',
      documentation: 'Debounced response to find()-triggered cache update.',
      isMerged: true,
      mergeDelay: 150,
      code: function() { this.on.reset.pub(); },
    },
  ],
});
