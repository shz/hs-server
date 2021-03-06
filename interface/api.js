///////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////

//
// Expects the following to exist:
//
//   JSON
//   sha256
//   console.log
//   localStorage
//   setTimeout
//   EventEmitter
//   croquet
//

// Global closure
(function() {

// Global config
config = {};
// Allowable models
config.datatypes = [
  // singular, plural
  'listing', 'listings',
  'offer', 'offers',
  'user', 'users',
  'convo', 'convos',
  'message', 'messages',
  'inquiry', 'inquiries'
];

//
// Initialize the zz object
//
var ZZ = function() {};
ZZ.prototype = new EventEmitter();
zz = new ZZ();
// Export EventEmitter in case somebody else wants it
zz.EventEmitter = EventEmitter;

//
// Misc zz settings
//
zz.waitThreshold = 1000;

//
// Logging Setup
//
zz.logging = {};
zz.logging.waiting = true;
zz.logging.connection = true;
zz.logging.responses = true;
zz.logging.incoming = {
  pub: false,
  presence: false,
  not: false
};
zz.logging.outgoing = {
  ping: false,
  error: false,
  auth: false,
  deauth: false,
  passwd: false,
  sub: false,
  unsub: false,
  create: false,
  update: false,
  'delete': false,
  'sub-presence': false,
  'unsub-presence': false
};

//
// Friendly log
//
var log = function(a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p) {
  // This braindead implementation brought to you by IE.
  (typeof window.console != 'undefined')
    && console.log(a || '', b || '', c || '', d || '', e || '', f || '',
                   g || '', h || '', i || '', j || '', k || '', l || '',
                   m || '', n || '', o || '', p || '');
};

//
// Analytics
//
var anl = function() {
  var args = Array.prototype.slice.call(arguments);
  if (this.mpq) mpq.push(args);
};

//
// Messaging util
//
var messaging = new EventEmitter();
(function() {
  // Message ID
  messaging.id = 1;
  // Callbacks (id -> callback)
  messaging.callbacks = {};
  // Actively pending responses
  var pendingResponses = 0;

  // Handles incoming messages
  messaging.handleMessage = function(msg) {

    // Log the message if we're configured to do so
    if (zz.logging.incoming[msg.type]) log(msg.type, msg.data);

    // If the message is a response, fire the appropriate callback
    if (msg.type == 'response' && messaging.callbacks[msg.data.id]) {
      messaging.callbacks[msg.data.id](msg.data);
      delete messaging.callbacks[msg.data.id];

    // Otherwise, pass it on to the correct handler by firing an event
    } else {
      messaging.emit(msg.type, msg.data);
    }
  };
  // Sends a message
  messaging.send = function(msg, data, callback) {

    // Grab an id and increment global id
    var id = messaging.id++;

    // Log if we're asked to
    if (zz.logging.outgoing[msg]) log(msg, id, data);

    // Default data
    data = data || {};

    // Set up a timeout to fire if this response takes too long
    var to = setTimeout(function() {
      // Increment the pending responses count.  If it was 0 prior to
      // this, then we need to fire the `waiting` event on zz.
      if (pendingResponses++ == 0) {
        zz.emit('waiting');
        if (zz.logging.waiting) log('Waiting');
      }

      // Clear the callback handle so that the response callback knows
      // it was fired.
      to = null;
    }, zz.waitThreshold);

    // Fire the message
    connection.send(id, msg, data);

    // Register the callback for this message's response
    messaging.callbacks[id] = function(data) {

      // If the timeout was fired, decrement the pending responses count
      // and fire the `done` message if it's back to 0
      if (to === null) {
        if (--pendingResponses <= 0) {
          zz.emit('done');
          if (zz.logging.waiting) log('Done Waiting');
        }
      // Otherwise, just clear the timeout
      } else {
        clearTimeout(to);
      }

      // Log the response if needed
      if (zz.logging.responses && zz.logging.outgoing[msg])
        log('response', id, data.value || data.error);

      // If there's no callback, break early
      if (!callback) return;

      // Dispatch to the callback for this ID, if it exists
      if (data.error) callback(new Error(data.error));
      else callback(undefined, data.value);
    };
  };
})();

//
// Connection Logic
//
// Auth Logic
//
var connection = new EventEmitter();
(function() {
  var con = new croquet.Connection(
    (/*$secure$*/ ? 'https://' : 'http://') +
    /*$host$*/ + ':' + /*$port$*/ + '/croquet'
  );

  var ready = false;
  var delayedMessages = [];
  var allowThrough = false;
  var inits = [];

  var makeReady = function() {

    // Ensure ready is set to true
    ready = true;

    // Start allowing messages through again
    allowThrough = true;

    // Call the onconnect callbacks
    connection.emit('connect');

    // Send all the delayed messages
    for (var i=0; i<delayedMessages.length; i++)
      try { con.send.apply(con, delayedMessages[i]) }
      catch(err) { log(err) }

    // Fire the inits if we need to
    if (inits.length)
      while (i=inits.shift())
        i();
  };
  var makeUnready = function() {
    // Stop messages from going through
    allowThrough = false;

    // Fire the ondisconnect callbacks
    connection.emit('disconnect');
  };

  // Set up logging
  con.on('connect', function() {
    if (zz.logging.connection)
      log('Connect');

    // Allow this auth message through
    allowThrough = true;
    // Attempt to reauth
    doAuth(undefined, undefined, function(err, email, password, userid) {

      // If the auth fails, we make ready here and stop
      if (err) return makeReady();

      // Otherwise, we want to fetch user data before making ready
      allowThrough = true;
      doAuthUser(email, password, userid, makeReady);
      if (!ready)
        allowThrough = false;
    });
    // But don't let anything else through
    if (!ready)
      allowThrough = false;
  });

  var holdDisconnect = false;
  con.on('disconnect', function() {
    if (zz.logging.connection)
      log('Disconnect');

    makeUnready();

    // If we didn't explicitly disconnect, try to reconnect
    if (!holdDisconnect) con.connect();
  });

  connection.send = function(id, type, data) {
    // Send messages if they're allowed through
    if (allowThrough) con.send.call(con, id, type, data);
    // Otherwise, delay the messages
    else delayedMessages.push([id, type, data]);
  };
  connection.connect = function() {
    holdDisconnect = false;
    con.connect();
  };
  connection.disconnect = function() {
    holdDisconnect = true;
    con.disconnect();
  };
  connection.pause = function() {
    con.pause();
  };
  connection.resume = function() {
    con.resume();
  };

  // Register the message handler
  con.on('message', messaging.handleMessage);

  // Forward pause/resume events
  con.on('pause', function() {
    if (zz.logging.connection)
      log('Pause');
    connection.emit('pause');
  });
  con.on('resume', function() {
    if (zz.logging.connection)
      log('Resume');
    connection.emit('resume');
  });

  // Our initialization/bootstrap function.
  zz.init = function(callback) {

    if (ready) {
      callback();
    } else {
      con.connect();
      inits.push(callback);
    }
  };

  //
  // Auth stuff
  //
  var AuthUser = function(user, email, password) {
    var self = this;

    user.heat();

    this.email = email;
    this.password = password;
    this._id = user._id;

    // Wire up the data
    var self = this;
    var fields = ['name', 'avatar', 'fb', 'twitter', 'linkedin'];
    for (var i=0; i<fields.length; i++) with ({i: i}) {
      this[fields[i]] = user[fields[i]];
      user.on(fields[i], function(val) {
        self[fields[i]] = val;
        self.emit(fields[i], val);
      });
    }

    // Create the destroy function
    this.destroy = function() {
      user.freeze();
      for (var i=0; i<fields.lenth; i++)
        this.removeAllListeners(fields[i]);
    };
  };
  AuthUser.prototype = new EventEmitter();

  var doAuth = function(email, password, callback) {
    // If both email and password are undefined, try to use the
    // stored credentials
    if (email === undefined && password === undefined) {
      email = localStorage['zz.auth.email'] || null;
      password = localStorage['zz.auth.password'] || null;

      // If either of those credentials was missing from local storage
      // then fail now via the callback
      if (email === null || password === null)
        return callback(new Error("Cannot auth with stored credentials because they're missing"));
    }

    // If the password doesn't appear to be of hashed form, do that
    // automatically.
    if (password && !password.match(/^[A-F0-9]{64}$/))
      password = sha256(password + email).toUpperCase();

      // Send the auth message
    messaging.send('auth', {email: email, password: password}, function(err, ret) {

      // If we didn't have an error, check the return value.  If it's
      // false, the auth was bad and we should set that as the error.
      if (!err && !ret)
        err = new Error('Incorrect username or password');

      // Pass errors on to the callback
      if (err) return callback && callback(err);

      // Save the password and the email to local storage for future use
      localStorage['zz.auth.email'] = email;
      localStorage['zz.auth.password'] = ret.password;

      // Fire the callback
      callback && callback(undefined, email, ret.password, ret.userid);
    });
  };

  var doAuthUser = function(email, password, userid, callback) {
    // Fetch the user object
    zz.data.user(userid, function(user) {

      // This is a rare error and will be handled with... pain
      if (user === null) throw new Error('Null user from auth');

      // Save the new current user
      if (curUser) curUser.destroy();
      curUser = new AuthUser(user, email, password);

      // Track this in mixpanel
      anl('identify', email);
      if (user.name) anl('name_tag', user.name);

      // Fire the success callback
      callback && callback(undefined);

    });
  };

  zz.auth = function(email, password, callback) {

    // Can't auth if we're already authed
    if (zz.auth.curUser()) throw new Error('Already authed');

    // Do the auth steps
    doAuth(email, password, function(err, email, password, userid) {

      // Break early on error
      if (err) return callback && callback(err);

      // Fetch the user object
      doAuthUser(email, password, userid, function() {
        // Emit the auth change event
        zz.auth.emit('change');

        // Fire success callback
        callback && callback();
      });
    });
  };

  zz.auth.changePassword = function(old, password, callback) {

    // Send the passwd message
    messaging.send('passwd', {old: old, password: password}, function(err, value) {

      // Handle user errors
      if (!err && !value) err = new Error(zz.auth.user ? 'Old password was incorrect'
                                                       : "Can't change password when not logged in");

      // Pass errors through
      if (err) return callback && callback(err);

      // Save the new password to local storage
      localStorage['zz.auth.password'] = value;

      // Update the current user object's password
      curUser.password = value;

      // Return success to the callback
      callback && callback(undefined);
    });
  };

  zz.auth.deauth = function(callback) {
    delete localStorage['zz.auth.email'];
    delete localStorage['zz.auth.password'];

    curUser.destroy();
    curUser = null;

    // Reconnect as soon as we disconnect
    connection.once('disconnect', connection.connect);
    connection.disconnect();

    callback && callback();

    zz.auth.emit('change');
  };

  zz.auth.resetPassword = function(email) {
    // Send the newpw message
    messaging.send('newpw', {email: email});
  };

  // Turn zz.auth into an event emitter by creating a new one and
  // monkey patching in all its functions
  with ({l: new EventEmitter}) {
    for (var i in l) if (typeof l[i] == 'function')
      zz.auth[i] = l[i];
  }

  // The user we're authenticated as, which is null to start
  var curUser = null;
  zz.auth.curUser = function() {
    return curUser;
  };
})();

//
// Ping
//
zz.ping = function(callback) {
  messaging.send('ping', null, function() {
    if (callback) callback();
    else log('pong');
  });
};

//
// Error
//
zz.recordError = function(err) {
  messaging.send('error', err);
};

//
// Presence
//
(function() {
  var subs = {};
  var status = {};

  zz.presence = new EventEmitter();
  zz.presence.status = 'offline';

  // Helpers
  var setOffline = function() {
    zz.presence.status = 'offline';
    zz.presence.emit('me', 'offline');

    // If the current user is me, send the presence update for them
    var u = zz.auth.curUser();
    if (u && u._id && subs.hasOwnProperty(u._id))
      zz.presence.emit(u._id, 'offline');
  };
  var setOnline = function() {
    zz.presence.status = 'online';
    zz.presence.emit('me', 'online');

    // If the current user is me, send the presence update for them
    var u = zz.auth.curUser();
    if (u && u._id && subs.hasOwnProperty(u._id))
      zz.presence.emit(u._id, 'online');
  };
  var setAway = function() {
    zz.presence.status = 'away';
    zz.presence.emit('me', 'away');

    // If the current user is me, send the presence update for them
    var u = zz.auth.curUser();
    if (u && u._id && subs.hasOwnProperty(u._id))
      zz.presence.emit(u._id, 'away');
  };

  // Set up events
  connection.on('disconnect', setOffline);
  connection.on('connect', setOnline);
  connection.on('pause', setAway);
  connection.on('resume', setOnline);

  zz.presence.offline = function() {
    if (zz.presence.status == 'offline') return;
    connection.disconnect();
  };

  zz.presence.online = function() {
    if (zz.presence.status == 'online') return;
    if (zz.presence.status == 'away')
      connection.resume();
    else
      connection.connect();
  };

  zz.presence.away = function() {
    // Eventually we'll add real away support
    if (zz.presence.status == 'away') return;
    connection.pause();
  };

  // Register the presence handler
  messaging.on('presence', function(data) {

    // If there are no longer any listeners for this user, remove
    // the sub and don't send the message.  The race condition here
    // has a benign failure mode, so we don't need to worry about it.
    if (zz.presence.listeners(data.user).length == 0) {
      messaging.send('unsub-presence', {user: data.user});
      delete subs[data.user];
      return;
    }

    // Convert status into something nice
    var status;
    switch (data.state) {
      case 0:
        status = 'offline';
        break;
      case 1:
        status = 'online';
        break;
      case 2:
        status = 'away';
        break;
    }; // Do we need a semicolon here?  Who knows!

    // Update the status for the sub
    if (data.user in subs)
      subs[data.user] = status;

    // Fire ze message
    zz.presence.emit(data.user, status);
  });

  // And here comes the magic.  When a user adds a presence listener,
  // we record the fact that they've done it.
  zz.presence.on('newListener', function(event, listener) {
    // Me is a special case and already handled
    if (event == 'me') return;

    // So is newListener...
    if (event == 'newListener') return;

    // For anything else, we need to ensure that there's a sub for
    // their presence.
    if (!subs[event]) {
      messaging.send('sub-presence', {user: event});
      subs[event] = 'offline';

    // If we're already subscribed for this presence, fire the event
    // automatically
    } else {
      listener(subs[event]);
    }

  });

  // When we reconnect, resub for presence
  connection.on('connect', function() {
    for (var i in subs) if (subs.hasOwnProperty(i))
      messaging.send('sub-presence', {user: i});
  });

  // On disconnect, fire the `offline` state on the current user
  connection.on('disconnect', function() {
    var user = zz.auth.curUser();

    // Nothing to do if we're not logged in
    if (!user) return;

    // Fire offline on the current user
    zz.presence.emit(user._id, 'offline');
  });
})();

//
// Data read layer logic
//
(function() {

  // Initialize he data layer
  zz.data = {};
  zz.models = {};

  // Active subscriptions
  var subs = {};

  // Base subscription class
  var Sub = function(key) {

    // Slight kludge; if key isn't present we just bail, since
    // it's probably just another subclass settings it as prototype.
    if (!key) return;

    var self = this;

    this.data = null;
    this.ready = false;
    this.key = key;
    // Add to the active subscriptions list
    subs[key] = this;
    // Set the reference count
    this.refs = 0;
    // Make the subscription, and notify the _sub listeners
    this._sub(function(data) {
      self.ready = true;

      self.emit('ready', data);
      self.removeAllListeners('ready');
    });
  };
  Sub.prototype = new EventEmitter();
  Sub.prototype._sub = function(callback) {
    var self = this;

    messaging.send('sub', {key: this.key}, function(err, data) {

      // Handle errors by deleting the subscription
      if (err) {
        delete subs[self.key];
        return log('Error while subscribing on key ' + self.key + ':', err.message);
      }
      // If we subbed on a bad key we don't want to exist in the subs
      // list.  However, we want to pass data along as null for
      // the sake of our listeners.
      if (data === false) {
        delete subs[self.key];
        data = null;
      // If we receive `true`, it means we're already subbed, and that
      // this sub is therefore a duplicate.  This is bad.
      } else if (data === true) {
        throw new Error('Double sub on key ' + self.key);
      }
      // Store the data
      if (data)
        self.update(data);

      // Call the callback
      if (callback) callback(self.data);
    });
  };
  Sub.prototype.resub = function() {
    var self = this;

    this._sub(function(data) {
      // If the data is null, the key no longer exists.  This is
      // rather weird and should be resolved somehow.
      if (data === null)
        return log('Resubbed, but key is no longer valid');

      self.update(data);
    });
  };
  Sub.prototype.update = function(data) { throw new Error('NYI') };
  Sub.prototype.destroy = function() {
    // Unsub this sub
    messaging.send('unsub', {key: this.key}, function(err, data) {
      // Handle errors by failing
      if (err) return log('Error while unsubbing:', err);
    });

    // And remove ourselves from the list
    delete subs[this.key];
  };
  Sub.prototype.retain = function() {
    this.refs++;
    if (this.destroyTimeout) clearTimeout(this.destroyTimeout);
  };
  Sub.prototype.release = function() {
    if (--this.refs < 1) {
      // Don't remove the subscription right away.  Instead, hold it
      // for about 10s in case anybody else wants it in that time.
      var self = this;
      self.destroyTimeout = setTimeout(function() {
        if (self.refs < 1) self.destroy();
      }, 10 * 1000);
    }
  };

  // Subscription on a model
  var ModelSub = function() {
    Sub.apply(this, Array.prototype.slice.call(arguments));
  };
  ModelSub.prototype = new Sub();
  ModelSub.prototype.update = function(data) {
    if (!this.data) this.data = {};

    for (var i in data) if (data.hasOwnProperty(i)) {
      var d = data[i];

      // Only update fields if they're different
      if (this.data[i] !== d
      // Dates are a little weird
      || (d instanceof Date && (+d) == (+this.data[i])) ) {
        // Update the field in our internal data storage
        this.data[i] = d;
        // Fire the relevant callback
        this.emit('field', i, d);
      }
    }
  };

  // Subscription on a relation
  var RelationSub = function() {
    Sub.apply(this, Array.prototype.slice.call(arguments));
  };
  RelationSub.prototype = new Sub();
  RelationSub.prototype.update = function(data) {
    if (!this.data) this.data = [];

    // If data is an array, treat it as add
    if (data instanceof Array)
      data = {add: data, remove: []};

    // Add elements
    var added = [];
    for (var i=0; i<data.add.length; i++) {
      var x = data.add[i];
      if (this.data.indexOf(x) == -1) {
        this.data.push(x);
        added.push(x);
      }
    }

    // Remove elements
    var removed = [];
    for (var i=0; i<data.remove.length; i++) {
      var x = data.remove[i];
      var n = this.data.indexOf(x);
      if (n >= 0) {
        this.data.splice(n, 1);
        removed.push(x);
      }
    };

    // Fire the appropriate events
    if (data.add.length)
      this.emit('add', added);
    if (data.remove.length)
      this.emit('remove', removed);
  };

  // Register a handler for `pub` messages so that we can update
  // the relevant sub
  messaging.on('pub', function(data) {
    if (!subs[data.key]) return log('Error: Dangling sub');

    subs[data.key].update(data.diff);
  });
  // Whenever auth changes, we have to resub everything.
  zz.init(function() {
    connection.on('connect', function() {
      for (var i in subs) if (subs.hasOwnProperty(i))
        subs[i].resub();
    });
  });
  // Whenever there's a disconnection, we should clear pending unsubs
  // right away.
  connection.on('disconnect', function() {
    for (var i in subs) if (subs.hasOwnProperty(i)) {
      // If it has a pending destroy timeout
      if (subs[i].destroyTimeout) {
        // Bypass the destroy logic entirely and just remove the sub
        clearTimeout(subs[i].destroyTimeout);
        delete subs[i];
      }
    }
  });

  // The Model class.  Note the separate `init` function; we need to
  // have constructor-style functionality, but can't do so in the
  // actual constructor because we use inheritance.  The `init` function
  // gets around this.
  var initModel = function(type) {
    this._type = type;  // Model type (e.g. 'listing')
    this._slis = [];    // Listeners we've registered on the sub
    this._sub = null;   // The current subscription.  Only set if hot.
    this._levents = {}; // The events currently being listened on this model.
    this.hot = false;   // Default hot state.

    var self = this;
    this.on('newListener', function(event, listener) {
      if (event != 'newListener') self._levents[event] = true;
    });
  };
  zz.models.Model = function() {};
  zz.models.Model.prototype = new EventEmitter();
  zz.models.Model.prototype.heat = function() {
    if (this.hot)
      throw new Error('Model is already hot');

    // This is a helper function that bootstraps all the data.
    var bootstrap = function(data) {
      for (var i in data) if (data.hasOwnProperty(i)) {
        //only update if needed
        if (self[i] != data[i]) {
          self[i] = data[i];
          self.emit(i, data[i]);
        }
      }
    };

    // Subscribe for changes.
    var self = this;
    // Grab an existing sub for this key, or create one
    this._sub = subs[this._id] || new ModelSub(this._id);
    // If the sub isn't ready we should listen on the ready event
    // so we can update data.
    if (!this._sub.ready)
      this._sub.on('ready', bootstrap) && this._slis.push(['ready', bootstrap]);
    // If the sub is ready, we need to just bootstrap the data from
    // it directly.
    else
      bootstrap(this._sub.data);

    // Listen on field events
    var field = function(field, val) {
      // The sub already checks whether the field changed before firing
      // the field event.
      self[field] = val;
      self.emit(field, val);
    };
    this._sub.on('field', field);

    // Push the field event listeners so we can remove it
    this._slis.push(['field', field]);

    // Increase the sub's retain count
    this._sub.retain();

    // Finally, mark this model as hot
    this.hot = true;
    return this;
  };
  zz.models.Model.prototype.freeze = function() {
    if (!this.hot) throw new Error('Model is already cold');

    // Unsubscribe all registered events on the sub
    for (var i=0; i<this._slis.length; i++) {
      var ev = this._slis[i];
      this._sub.removeListener(ev[0], ev[1]);
    }
    this._slis = [];
    // Decrease the reference count of the base sub
    this._sub.release();
    this._sub = null;
    // Unregister all events registered on this model
    for (var i in this._levents) if (this._levents.hasOwnProperty(i))
      this.removeAllListeners(i)
    this._levents = {};

    // Finally, mark this model as cold
    this.hot = false;
    return this;
  };

  // The ModelList class.  Note the separate `init` method; we need
  // a central place to initialize this beast, but use a constructor
  // due to the intheritance.
  var initModelList = function(type, ids, key, callback) {
    this._type = type;  // Model type (e.g. 'listing')
    this._slis = [];    // Listeners we've registered on the sub
    this._sub = null;   // The current subscription.  Only set if hot.
    this._levents = {}; // The events currently being listened on this model.
    this._key = key;    // The key we're subscribed on
    this.hot = false;   // Default hot state.

    // Monkey patch in EventEmitter
    var em = new EventEmitter();
    for (var i in em) this[i] = em[i];

    // Whenever listeners are registered, we should record them so we
    // can remove them.
    var self = this;
    this.on('newListener', function(event, listener) {
      if (event != 'newListener') self._levents[event] = true;
    });

    // Fetch all models and insert them
    var toFetch = ids.length;
    for (var i=0; i<ids.length; i++) {
      zz.data[type](ids[i], function(m) {
        // Add the model to ourselves
        self.push(m);

        // If we've fetched all the objects, fire the callback
        if (--toFetch == 0) {
          callback(self);
        }
      });
    }
    // If there were no IDs that loop would never get called, and the
    // callback would thusly never fire.  We handle that case here.
    if (!ids.length) callback && callback(this);
  };

  zz.models.ModelList = function() {};
  zz.models.ModelList.prototype = [];
  zz.models.ModelList.prototype.related = {};
  zz.models.ModelList.prototype.heat = function() {
    if (this.hot) throw new Error('ModelList is already hot');

    // We're gonna need this...
    var self = this;

    // Helper functions to add and remove elements
    var add = function(ids) {
      for (var i=0; i<ids.length; i++) {
        var id = ids[i];

        // For safety, we should check that the given model ID isn't
        // already in our list.  Luckily, our Sub does this for us.

        // Fetch the model
        zz.data[self._type](id, function(m) {
          // If this isn't a sorted list just push it and call it
          // a day.  We can share this case with zero length arrays
          // as well.
          if (!self.sorted || self.length == 0) {
            self.push(m);
            self.emit('add', m, self.length-1);
            return;
          }

          // Otherwise, do a binary search for the position to
          // insert at.
          var end = self.length;
          var start = 0;
          i = null;

          // Edge case handling, because the first item is a little
          // funky
          if (self._cmp(self[0], m) > 0) i = 0;

          while (i === null) {
            if (start + 1 == end) {
              i = start + 1;
              break;
            }

            var p = start + parseInt((end - start) / 2 + 0.5);

            var c = self._cmp(self[p], m);
            if (c == 0)
              i = p + 1;
            else if (c > 0)
              end = p;
            else // if (c < 0)
              start = p;
          }

          // Splice the element in there, and send the event.
          self.splice(i, 0, m);
          self.emit('add', m, i);
        });
      }
    };
    var remove = function(ids) {
      for (var i=0; i<ids.length; i++) {
        var id = ids[i];

        // Find the ID the model's at
        for (var i=0; i<self.length; i++)
          if (self[i]._id == id)
            break;

        // If we couldn't find the model, then do nothing
        if (i == self.length) return;

        // Otherwise, splice it out
        self.splice(i, 1);

        // And send the event on to listeners
        self.emit('remove', id, i);
      }
    };

    // This is a helper function that bootstraps all the data.
    var bootstrap = function(_ids) {
      // Collect current ids
      var curIds = [];
      for (var i=0; i<self.length; i++)
        curIds.push(self[i]._id);

      // Clone _ids so that we don't shift it into oblivion
      var ids = [];
      for (var i=0; i<_ids.length; i++)
        ids.push(_ids[i]);

      // Sort them so that we can optimize
      ids.sort();
      curIds.sort();

      // Find things we need to add and remove
      var toRemove = [];
      var toAdd = [];

      // Think mergesort, and coroutines.
      var c = curIds.shift();
      var i = ids.shift();
      while (c !== undefined || i !== undefined) {
        if (c == i) {
          c = curIds.shift();
          i = ids.shift();
        }
        for (; i !== undefined && (c === undefined || i<c); i=ids.shift())
          toAdd.push(i);
        for (; c !== undefined && (i === undefined || c<i); c=curIds.shift())
          toRemove.push(c);
      }

      // Do the work
      remove(toRemove);
      add(toAdd);
    };

    // Grab an existing sub for this key, or create one
    this._sub = subs[this._key] || new RelationSub(this._key);
    // If the sub isn't ready we should listen on the ready event
    // so we can update data.
    if (!this._sub.ready)
      this._sub.on('ready', bootstrap) && this._slis.push(['ready', bootstrap]);
    // If the sub is ready, we need to just bootstrap the data from
    // it directly.
    else
      bootstrap(this._sub.data);

    // Listen on field events
    this._sub.on('add', add);
    this._sub.on('remove', remove);

    // Push the field event listeners so we can remove it
    this._slis.push(['add', add]);
    this._slis.push(['remove', remove]);

    // Increase the sub's retain count
    this._sub.retain();

    // Finally, mark this model as hot
    this.hot = true;
    return this;
  };
  zz.models.ModelList.prototype.freeze = function() {
    if (!this.hot) throw new Error('ModelList is already cold');

    // Unsubscribe all registered events on the sub
    for (var i=0; i<this._slis.length; i++) {
      var ev = this._slis[i];
      this._sub.removeListener(ev[0], ev[1]);
    }
    this._slis = [];
    // Decrease the reference count of the base sub
    this._sub.release();
    this._sub = null;
    // Unregister all events registered on this model
    for (var i in this._levents) if (this._levents.hasOwnProperty(i))
      this.removeAllListeners(i)
    this._levents = {};

    // Finally, mark this model list as cold
    this.hot = false;
    return this;
  };
  zz.models.ModelList.prototype.sort = function(cmp) {
    if (!cmp) throw new Error('Sorry, unlike native .sort(), you must provide a comparator');

    // Set the sorted state
    this.sorted = true;
    this._cmp = cmp;

    // Do the initial sort
    if (this.length > 1) // Slight optimization
      Array.prototype.sort.call(this, cmp);

    return this;
  };
  zz.models.ModelList.prototype.unsort = function() {
    delete this.sorted;
  };

  // Helper function -- ensures we have a sub for the specified key
  // and fires the callback when the sub is ready
  var _get = function(key, callback) {
    if (!key) throw new Error('Trying to use _get on a falsey key');

    // Figure out the type to fetch.  If the key starts with \w+/, then
    // it's a model sub.  Anything else is a relation sub.
    var type = key.match(/^\w+\//) ? ModelSub
                                   : RelationSub


    var sub = subs[key] || new type(key);
    if (!sub.ready) {
      sub.on('ready', callback);
    } else {
      callback(sub.data);
    }
  };

  // Data initialization
  for (var i=0; i<config.datatypes.length; i+=2) {
    var type = config.datatypes[i];
    var ptype = config.datatypes[i+1];

    // Create and register the model for this type
    var M = function() {};
    M.fname = type[0].toUpperCase() + type.substr(1);
    zz.models[M.fname] = M;
    M.prototype = new zz.models.Model();

    // Create and register the related list for this type
    var ML = function() {};
    ML.fname = type[0].toUpperCase() + type.substr(1) + 'List';
    zz.models[ML.fname] = ML;
    ML.prototype = new zz.models.ModelList();

    // Add the relation
    with ({type: type, ptype: ptype, M: M, ML: ML}) {
      zz.models.Model.prototype['related' + ptype[0].toUpperCase() + ptype.substr(1)] = function() {

        // Arguments
        var field;
        var callback;

        // Magic arguments
        var args = Array.prototype.slice.call(arguments);
        if (args.length > 1)
          field = args.shift();
        callback = args.shift();
        delete args;

        // Callback must be supplied
        if (!callback || typeof callback != 'function')
          throw new Error('No callback was supplied');

        // Set the default field
        if (!field) field = this._type;

        // Generate the key
        var key = type + '(' + field + '=' + this._id + ')';

        // Get the sub
        _get(key, function(data) {
          // If the data is null, we can pass that straight down
          // to the callback.
          if (data === null) return callback(null);

          // Create the model list, and when it's initialized return
          // it via the callback;
          var ml = new ML();
          initModelList.call(ml, type, data, key, function(ml) {
            callback(ml);
          });
        });
      };

      // Create the fetcher
      zz.data[type] = function() {

        // Arguments
        var thing;
        var fields = [];
        var callback;

        // Magic arguments
        var args = Array.prototype.slice.call(arguments);
        thing = args.shift();
        while (args.length > 1)
          fields.push(args.shift());
        callback = args[0];

        // Validate arguments
        if (typeof thing != 'string' && typeof thing != 'object')
          throw new Error('Thing to fetch on must be a string or a Model; ' +
                          'instead it was ' + typeof thing);
        if (!callback || typeof callback != 'function')
          throw new Error('No callback was supplied');
        if (typeof thing == 'string' && fields.length)
          throw new Error('Fetching through fields is invalid with a string argument');

        // If the thing is an object, we need to do a bit of work to
        // get the fields ID we're looking for.
        if (typeof thing == 'object') {
          // If no fields were specified and the thing was an object, we
          // need to get the ID from the default fild on that object.
          if (fields.length == 0)
            thing = thing[type];

          // If there's just a single field specified, we need to just
          // use an explicit field from the object to get the ID.
          else if (fields.length == 1)
            thing = thing[fields[0]];

          // Otherwise, we need to fetch multiple fields through multiple
          // objects.  This is pretty simple to do -- just
          else return _get(thing[fields.shift()], function(data) {
            var type = data._id.split('/')[0];
            zz.data[type].apply(this, [data].concat(fields.concat([callback])));
          });
        }

        // At this point, thing is a string set to the key of the thing
        // we're looking for.  We can do a basic get on that key and
        // then return it to the client.
        _get(thing, function(data) {

          // If the data is null, we can pass that straight down
          // to the callback.
          if (data === null) return callback(null);

          // Clone the data into the appropriate model
          var m = new M();
          initModel.call(m, type);
          for (var i in data) if (data.hasOwnProperty(i))
            m[i] = data[i];

          // Return the model to the user
          callback(m);
        });
      };
    }
  }
})();

//
// Querying
//
(function() {

var Query = function(type, query) {
  this._type = type;
  this._query = query || '';
};
Query.prototype._ret = function(callback) {
  if (callback) {

    var data = {
      type: this._type,
      query: this._query
    };
    if (this._limit) data.limit = this._limit;
    if (this._offset) data.offset = this._offset;
    if (this._sort) data.sort = this._sort;
    if (this._params) data.params = this._params;

    messaging.send('query', data, function(err, ids) {
      if (err) log('Error querying ' + data.query);
      else callback(ids);
    });

    return undefined;
  } else {
    return this;
  }
};
Query.prototype.offset = function(n, callback) {
  if (typeof n != 'number') throw new Error('Must specify a number');
  this._offset = n;

  return this._ret(callback);
};
Query.prototype.limit = function(n, callback) {
  if (typeof n != 'number') throw new Error('Must specify a number');
  this._limit = n;

  return this._ret(callback);
};
Query.prototype.sort = function(s, callback) {
  if (typeof s != 'string') throw new Error('Must specify a string');
  this._sort = s;

  return this._ret(callback);
};
Query.prototype.params = function(p, callback) {
  for (var i in p) if (p.hasOwnProperty(i))
    if (typeof p[i] != 'string' && typeof p[i] != 'number')
      throw new Error('Invaild data type for parameter ' + i + ': ' + typeof p[i]);

  this._params = p;

  return this._ret(callback);
};
Query.prototype.run = function(callback) {
  return this._ret(callback);
};


// Add a queryer to each datatype
var type;
for (var i=0; i<config.datatypes.length; i+=2) with ({i: i, type: type}) {
  type = config.datatypes[i];

  zz.data[type].query = function(query, callback) {
    if (typeof query == 'function')
      throw new Error('Cannot run a query with no name, limit, offset, or sort');

    var query = new Query(type, query);
    return query._ret(callback);
  };
}

// End querying closure
})();

//
// Data creation
//
(function() {

var validate = function(data) {

  // Validate the data
  for (var i in data) if (data.hasOwnProperty(i)) {
    var d = data[i];

    // Auto convert id
    if (d instanceof zz.models.Model) data[i] = d._id;

    // Check data types
    else switch (typeof d) {
      case 'string':
      case 'boolean':
      case 'number':
      case 'object':
        continue;
      default:
        throw new Error("Can't send data of type " + typeof d + " in field " + i);
    }
  }

};

zz.create = {};
for (var i=0; i<config.datatypes.length; i+=2) {
  with ({type: config.datatypes[i]}) {
    zz.create[type] = function(data, callback) {

      // validate and convert the data
      validate(data);

      messaging.send('create', {type: type, data: data}, function(err, ret) {
        if (err)
          throw new Error('Failed to create ' + type + ': ' + err.message);
        else if (!ret)
          throw new Error('Validation error when creating ' + type);

        // Track all creates
        anl('track', 'create', {type: type});

        callback && callback(ret);
      });
    };
  }
}

//
// Data update
//
zz.update = {};
for (var i=0; i<config.datatypes.length; i+=2) {
  with ({type: config.datatypes[i]}) {
    zz.update[type] = function(key, diff, callback) {

      // Update can either be passed an ID, or a model
      var key = typeof key == 'string' ? key
                                       : key._id;

      // Validate and convert the data
      validate(diff);

      messaging.send('update', {key: key, diff: diff}, function(err, ret) {
        if (err)
          throw new Error('Failed to update ' + type + ': ' + err.message);
        else if (!ret)
          throw new Error('Validation error when updating ' + type);

        callback && callback();
      });
    };
  }
}

// End create/update closure
})();

//
// Notifications
//
messaging.on('not', function(data) {
  zz.emit('notification', data.message, data.key, data.other);
});

// End global closure
})();
