// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

require('./http_jdao.es6.js');
require('./http_json_dao.es6.js');
require('./web_apis/release_interface_relationship.es6.js');
const pkg = org.chromium.apis.web;

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'SyncDAOMonitor',
  implements: ['foam.mlang.Expressions'],

  imports: ['info'],

  properties: [
    {
      class: 'foam.dao.DAOProperty',
      name: 'dao',
      required: true,
      postSet: function(old, nu) {
        if (!nu) return;
        foam.assert(nu.synced && nu.synced.then,
                    'SyncDAOMonitor expects "dao.synced" to be thenable');
        foam.assert(nu.synced$ && nu.synced$.sub,
                    'SyncDAOMonitor expects "dao.synced$" to be subscribable');
        if (this.syncedSub_) this.syncedSub_.detach();
        this.syncedSub_ = nu.synced$.sub(this.onSyncedChanged);
        // Synthetic "synced" property propertyChange-event.
        this.onSyncedChanged(
            this.syncedSub_, 'propertyChange', 'synced', nu.synced$);
      },
    },
    {
      class: 'String',
      name: 'name',
      expression: function(dao) {
        return dao && dao.of && dao.of.id ? dao.of.id :
            'synced data';
      },
    },
    {
      class: 'Int',
      name: 'latestVersion_',
    },
  ],

  listeners: [
    function onSyncedChanged(_, __, ___, synced$) {
      synced$.get().then(this.onSynced);
    },
    function onSynced() {
      this.dao
          // Like MAX(), but faster on DAOs that can optimize order+limit.
          .orderBy(this.DESC(this.dao.of.VERSION_)).limit(1).select()
          .then(this.onSyncedSelect);
    },
    function onSyncedSelect(arraySink) {
      const latestRecord = arraySink.array[0];
      if (!latestRecord) return;
      const latestVersion = latestRecord.version_;
      foam.assert(latestVersion >= this.latestVersion_,
                  'SyncDAOMonitor expects version to increase monotonically');

      if (this.dao.polling) {
        this.info(`DAO, ${this.name}, synced
                       (polling every ${this.dao.pollingFrequency}ms)`);
      }

      if (latestVersion > this.latestVersion_) {
        this.info(`DAO, ${this.name}, synced from version ${this.latestVersion_}
                       to ${latestVersion}`);
        this.latestVersion_ = latestVersion;
      }
    },
  ],
});

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'ConfluenceSyncDAO',
  extends: 'foam.dao.ProxyDAO',

  requires: [
    'com.google.cloud.datastore.BatchMutationDatastoreDAO',
    'foam.dao.MDAO',
    'foam.dao.NodeFileJournal',
    'foam.dao.SyncDAO',
    'foam.dao.sync.VersionedSyncRecord',
    'org.chromium.apis.web.HttpJDAO',
    'org.chromium.apis.web.SyncDAOMonitor',
    'org.chromium.apis.web.VersionedReleaseWebInterfaceJunction',
  ],
  imports: ['container'],

  properties: [
    {
      name: 'delegate',
      transient: true,
      factory: function() {
        this.validate();

        // TODO(markdittmer): Clean this up. Need a way to override lookup and
        // requiresCreate.
        const lookup = this.lookup.bind(this);

        const indexedMDAO = lookup('foam.dao.MDAO').create({
          of: this.of,
        }, this.container.ctx);
        // Index release's ID on release/interface junction DAO.
        //
        // TODO(markdittmer): This shouldn't be here. Either MDAO should know
        // about relationships and auto-index this, or a decorator should add
        // relationship indexes iff its "of" is a relationship junction.
        if (this.of === pkg.VersionedReleaseWebInterfaceJunction) {
          indexedMDAO.addPropertyIndex(
              pkg.ReleaseWebInterfaceJunction.SOURCE_ID);
        }

        // Immediate delegate is foam.dao.SyncDAO; exposes "synced" Promise.
        const delegate = lookup('foam.dao.SyncDAO').create({
          of: this.of,
          delegate: lookup('org.chromium.apis.web.HttpJDAO').create({
            of: this.of,
            delegate: indexedMDAO,
            url: `https://storage.googleapis.com/web-api-confluence-data-cache/latest/journal/${this.of.id}-journal.js`,
          }, this.container.ctx),
          syncRecordDAO: lookup('foam.dao.MDAO').create({
            of: this.of,
          }, this.container.ctx),
          remoteDAO: this.remoteDAO,
          polling: true,
          pollingFrequency: 1000 * 60 * 60,
        }, this.container.ctx);

        // Point monitor at delegate.
        this.monitor_.dao = delegate;

        return delegate;
      },
    },
    {
      class: 'foam.dao.DAOProperty',
      name: 'remoteDAO',
      transient: true,
      factory: function() {
        // TODO(markdittmer): Clean this up. Need a way to override lookup and
        // requiresCreate.
        const lookup = this.lookup.bind(this);
        return lookup('foam.dao.NoDisjunctionDAO').create({
          of: this.of,
          delegate: lookup(
            'com.google.cloud.datastore.BatchMutationDatastoreDAO').create({
              of: this.of,
              numBatches: 25,
            }, this.container.ctx),
        }, this.container.ctx);
      },
    },
    {
      class: 'FObjectProperty',
      of: 'org.chromium.apis.web.SyncDAOMonitor',
      name: 'monitor_',
      transient: true,
      factory: function() {
        return foam.lookup('org.chromium.apis.web.SyncDAOMonitor')
            .create(null, this.container.ctx);
      },
    },
  ],

  methods: [
    {
      name: 'hasSynced',
      documentation: 'Provides API to delegate "synced" Promise.',
      returns: 'Promise',
      code: function() { return this.delegate.synced; },
    },
    {
      name: 'lookup',
      documentation: 'Perform lookup on container context.',
      code: function(id) {
        return (this.container.ctx || this.container).lookup(id);
      }
    },
    function getDataJournalFD_() {
      return require('fs').openSync(
          require('path').resolve(
              __dirname,
              `../data/journal/${this.of.id}-journal.js`),
          'r');
    },
    function getSyncRecordFD_() {
      return require('fs').openSync(
          require('path').resolve(
              __dirname,
              `../data/journal/foam.dao.sync.VersionedSyncRecord-${this.of.id}-journal.js`),
          'r');
    },
  ],
});

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'ConfluenceProxyDAO',
  extends: 'foam.dao.ProxyDAO',

  properties: [
    {
      name: 'delegate',
      transient: true,
    }
  ],
});

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'ConfluencePollingDAO',
  extends: 'foam.dao.ProxyDAO',

  requires: [
    'foam.dao.MDAO',
    'org.chromium.apis.web.ConfluenceProxyDAO',
    'org.chromium.apis.web.HttpJsonDAO',
  ],
  imports: [
    'clearInterval',
    'container',
    'setInterval',
    'setTimeout',
  ],

  properties: [
    {
      class: 'String',
      name: 'url',
      required: true,
    },
    {
      class: 'Int',
      name: 'pollingFrequency',
      factory: function() { return 1000 * 60 * 60; },
      postSet: function() {
        if (!this.isActive_) return;
        this.clearTimer_();
        this.setTimer_();
      },
    },
    {
      name: 'delegate',
      transient: true,
      factory: function() {
        this.setTimeout(() => this.isActive_ = true, 0);
        return this.getNewDelegate_();
      },
    },
    {
      class: 'Int',
      name: 'timerId_',
    },
    {
      class: 'Boolean',
      name: 'isActive_',
      postSet: function() {
        this.clearTimer_();
        if (this.isActive_) this.setTimer_();
      },
    },
    {
      name: 'ctx_',
      getter: function() {
        return this.container.ctx || this.container;
      },
    },
  ],

  methods: [
    {
      name: 'hasSynced',
      documentation: 'Provides API to delegate "synced" Promise.',
      returns: 'Promise',
      code: function() {
        // Delegate chain is either:
        // (1) Proxy => HttpJsonDAO (with .promise property), OR
        // (2) Proxy => MDAO (with no .promise property).
        const delegate = this.delegate.delegate;
        return delegate.promise ?
            // Wait for delegate.promise to resolve, but do not attempt to
            // return it to (potentially) remote caller.
            delegate.promise.then(() => undefined) :
            Promise.resolve();
      },
    },
    {
      name: 'lookup',
      documentation: 'Perform lookup on container context.',
      code: function(id) {
        return this.ctx_.lookup(id);
      }
    },
    function getNewDelegate_() {
      this.validate();

      // TODO(markdittmer): Clean this up. Need a way to override lookup and
      // requiresCreate.
      const lookup = this.lookup.bind(this);

      const indexedMDAO = lookup('foam.dao.MDAO').create({
        of: this.of,
      }, this.ctx_);
      // Index release's ID on release/interface junction DAO.
      //
      // TODO(markdittmer): This shouldn't be here. Either MDAO should know
      // about relationships and auto-index this, or a decorator should add
      // relationship indexes iff its "of" is a relationship junction.
      if (this.of === pkg.ReleaseWebInterfaceJunction) {
        indexedMDAO.addPropertyIndex(
            pkg.ReleaseWebInterfaceJunction.SOURCE_ID);
      }

      // Initialize HttpJsonDAO from URL.
      const httpJsonDAO = lookup('org.chromium.apis.web.HttpJsonDAO').create({
        of: this.of,
        url: this.url,
      }, this.ctx_);

      // Initially, proxy to HttpJsonDAO, which will produce an unindexed
      // ArrayDAO as soon as data are available.
      const proxy = lookup('org.chromium.apis.web.ConfluenceProxyDAO').create({
        delegate: httpJsonDAO
      }, this.ctx_);

      // Once data are available, fill indexed DAO and redirect proxy to it.
      httpJsonDAO.promise.then(arrayDAO => {
        foam.assert(lookup('foam.dao.ArrayDAO').isInstance(arrayDAO),
                    'Expected HttpJsonDAO to resolve to foam.dao.ArrayDAO');
        const array = arrayDAO.array;
        for (const item of array) {
          indexedMDAO.put(item);
        }
        proxy.delegate = indexedMDAO;
      });

      return proxy;
    },
    function clearTimer_() {
      if (this.timerId_) {
        this.clearInterval(this.timerId_);
        this.timerId_ = 0;
      }
    },
    function setTimer_() {
      this.hasSynced().then(() => {
        if (this.timerId_ !== 0) return;
        this.timerId_ = this.setInterval(
            this.onTimeout, this.pollingFrequency);
      });
    },
  ],

  listeners: [
    function onTimeout() {
      const newDelegate = this.getNewDelegate_();
      // New delegate chain: Proxy => HttpJsonDAO (with .promise property).
      newDelegate.delegate.promise.then(() => this.delegate = newDelegate);
    },
  ],
});

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'ConfluenceBaseClientDAO',
  extends: 'foam.dao.AbstractDAO',

  documentation: 'Like foam.dao.BaseClientDAO, but stubs "hasSynced".',

  properties: [
    {
      class: 'Stub',
      of: 'org.chromium.apis.web.ConfluenceSyncDAO',
      name: 'delegate',
      methods: [
        'hasSynced',
        'put_',
        'remove_',
        'removeAll_',
        'select_',
        'listen_',
        'find_',
      ],
    },
  ],
});

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'ConfluenceClientDAO',
  extends: 'org.chromium.apis.web.ConfluenceBaseClientDAO',
  implements: ['foam.dao.ClientDAO'],

  documentation: 'Like foam.dao.ClientDAO, but stubs "hasSynced".',
});
