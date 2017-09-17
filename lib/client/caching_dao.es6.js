// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

foam.CLASS({
  name: 'QueryCache',
  package: 'org.chromium.apis.web',

  imports: ['setTimeout'],

  classes: [
    {
      name: 'QueryRecord',

      properties: [
        {
          class: 'String',
          name: 'id',
          documentation: 'Identify by query contents.',
          expression: function(skip, limit, order, predicate) {
            return `${skip},${limit},${order ? order.toString() : null},${predicate ? predicate.toString() : null}`;
          },
        },
        {
          class: 'Int',
          name: 'skip',
          documentation: '"skip" argument from DAO.select().',
        },
        {
          class: 'Int',
          name: 'limit',
          documentation: '"limit" argument from DAO.select().',
          value: Infinity,
        },
        {
          name: 'order',
          documentation: '"order" argument from DAO.select().',
        },
        {
          name: 'predicate',
          documentation: '"predicate" argument from DAO.select().',
        },
        {
          class: 'Array',
          name: 'array',
          documentation: `Array of results or null. Null iff complete array of
              results from querying remote have been put to delegate cache.`,
        },
      ],
    },
  ],

  properties: [
    {
      class: 'foam.dao.DAOProperty',
      name: 'delegate',
      documentation: 'Synchronous cache DAO where results are eventually put.',
    },
    {
      class: 'Int',
      name: 'batchSize',
      documentation: 'Size of synchronous batch puts to delegate.',
      value: 500,
    },
    {
      class: 'Int',
      name: 'cacheFillDelay',
      documentation: `Delay after remote results arrive before array=>delegate
          cache fill begins. A longer delay increases likelihood that clients
          re-issuing the same query in response to on.reset from DAO will get
          cached array result. A shorter delay keeps the delegate cache more
          up to date (for other queries).`,
      value: 250,
    },
    {
      class: 'Int',
      name: 'batchDelay',
      documentation: 'Delay between array=>delegate cache fill batches.',
      value: 1,
    },
    {
      class: 'Array',
      // of: 'QueryRecord',
      name: 'queries_',
      documentation: 'Queries that are cached by this and/or its delegate.',
    },
    {
      class: 'Int',
      name: 'nextQueryIdx_',
      documentation: 'Next index in "queries_" to be put to delegate.',
    },
    {
      class: 'Int',
      name: 'nextReadyQueryIdx_',
      documentation: `Next index in "queries_" that has timed out and is ready
          to be pushed to delegate.`,
    },
  ],

  methods: [
    {
      name: 'getCachedQueryRecord',
      documentation: `Get the cached QueryRecord for a query, or null if query
          not cached.`,
      code: function(skip, limit, order, predicate) {
        const queryRecord = this.QueryRecord.create({
          skip,
          limit,
          order,
          predicate,
        });

        const queries = this.queries_;
        for (let i = 0; i < queries.length; i++) {
          if (queries[i].id === queryRecord.id)
            return queries[i];
        }

        return null;
      },
    },
    {
      name: 'getCachedQueryArray',
      documentation: `Get Promise for results array associated with a cached
          QueryRecord, or null if QueryRecord not cached.`,
      code: function(queryRecord) {
        const qr = queryRecord;
        if (qr === null) return Promise.resolve(null);
        if (Array.isArray(qr.array)) return Promise.resolve(qr.array);
        return this.delegate.select(null, qr.skip, qr.limit, qr.order,
                                    qr.predicate)
            .then(function(arraySink) { return arraySink.array; });
      },
    },
    {
      name: 'storeQuery',
      documentation: `Synchronously cache array of query results without paying
          the cost of immediately updating delegate cache DAO.`,
      code: function(skip, limit, order, predicate, array) {
        this.queries_.push(this.QueryRecord.create({
          skip,
          limit,
          order,
          predicate,
          array,
        }));
        this.setTimeout(this.onStoreQuery.bind(this, this.queries_.length - 1),
                        this.cacheFillDelay);
      },
    },
    function sendToDelegate_(array, idx) {
      const limit = Math.min(array.length, idx + this.batchSize);
      let i;
      for (i = 0; i < limit; i++) {
        // Assume that put() is synchronous; no need to accumulate Promises.
        this.delegate.put(array[i]);
      }
      if (i < array.length) {
        this.setTimeout(this.sendToDelegate_.bind(this, array, i),
                        this.batchDelay);
      } else {
        this.nextQueryIdx_++;
        if (this.nextQueryIdx_ <= this.nextReadyQueryIdx_)
          this.pushNextQuery_();
      }
    },
    function pushNextQuery_() {
      const queryRecord = this.queries_[this.nextQueryIdx_];
      if (queryRecord.array === null) return;

      const array = queryRecord.array;
      queryRecord.array = null;
      this.sendToDelegate_(array, 0);
    },
  ],

  listeners: [
    {
      name: 'onStoreQuery',
      code: function(idx) {
        this.nextReadyQueryIdx_ = idx;
        if (idx > this.nextQueryIdx_) return;
        this.pushNextQuery_();
      },
    },
  ],
});

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
    'org.chromium.apis.web.QueryCache',
  ],

  properties: [
    {
      class: 'foam.dao.DAOProperty',
      documentation: 'Remote DAO; authoritative data source.',
      name: 'remote',
    },
    {
      class: 'Int',
      name: 'batchSize',
      value: 500,
    },
    {
      class: 'Int',
      name: 'cacheFillDelay',
      documentation: `Delay after remote results arrive before array=>delegate
          cache fill begins.`,
      value: 250,
    },
    {
      class: 'Int',
      name: 'batchDelay',
      documentation: 'Delay between array=>delegate cache fill batches.',
      value: 1,
    },
    {
      class: 'FObjectProperty',
      of: 'org.chromium.apis.web.QueryCache',
      name: 'queryCache_',
      factory: function() {
        return this.QueryCache.create({
          batchSize: this.batchSize,
          cacheFillDelay: this.cacheFillDelay,
          batchDelay: this.batchDelay,
          delegate: this.delegate,
        });
      },
    },
  ],

  methods: [
    function select_(ctx, sink, skip, limit, order, predicate) {
      sink = sink || this.ArraySink.create(null, ctx);
      const queryRecord = this.queryCache_.getCachedQueryRecord(
          skip, limit, order, predicate);

      // If query is cached, get array of results and send them to sink.
      if (queryRecord !== null) {
        return this.queryCache_.getCachedQueryArray(queryRecord)
            .then(array => {
              for (let i = 0; i < array.length; i++) {
                // TODO(markdittmer): Pass detachable for flow control.
                sink.put(array[i]);
              }
              sink.eof && sink.eof();
              return sink;
            });
      }

      // Results not cached. Fetch them from remote and store the result in
      // query cache.
      this.remote.select_(ctx, null, skip, limit, order, predicate)
        .then(arraySink => {
          this.queryCache_.storeQuery(skip, limit, order, predicate,
                                      arraySink.array);
          this.on.reset.pub();
        });

      // Return current cached results.
      return this.delegate.select_(ctx, sink, skip, limit, order, predicate);
    },
    function find_(ctx, objOrId) {
      const remotePromise = this.remote.find_(ctx, objOrId);
      const delegatePromise = this.remote.find_(ctx, objOrId);

      // Wait for remote and delegate results; if different, update cache and
      // publish on.reset.
      Promise.all([remotePromise, delegatePromise])
          .then(founds => {
            const remoteFound = founds[0];
            const delegateFound = founds[1];
            if (!foam.util.equals(remoteFound, delegateFound)) {
              if (remoteFound === null) {
                this.delegate.remove_(ctx, objOrId);
              } else {
                this.delegate.put_(ctx, remoteFound);
              }
              this.onFindReset();
            }
          });

      // Return delegate value, if found. Otherwise, wait for remote result.
      return delegatePromise
        .then(found  => found === null ? remotePromise : found);
    },
  ],

  listeners: [
    {
      name: 'onFindReset',
      documentation: 'Debounced response to find()-triggered cache update.',
      isMerged: true,
      mergeDelay: 150,
      code: function() { this.on.reset.pub(); },
    },
  ],
});
