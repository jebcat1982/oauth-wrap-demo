/**
 * Copyright Facebook Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 *
 *
 * @provides fb.xd
 * @requires fb.prelude
 *           fb.qs
 *           fb.flash
 */

/**
 * The cross domain communication layer.
 *
 * @class FB.XD
 * @static
 * @access private
 */
FB.copy('XD', {
  _origin    : null,
  _transport : null,
  _callbacks : {},

  /**
   * Initialize the XD layer. Native postMessage or Flash is required.
   *
   * @access private
   */
  init: function() {
    // only do init once, if this is set, we're already done
    if (FB.XD._origin) {
      return;
    }

    // The origin is used for:
    // 1) postMessage origin, provides security
    // 2) Flash Local Connection name
    // It is required and validated by Facebook as part of the xd_proxy.php.
    FB.XD._origin = (
      window.location.protocol +
      '//' +
      window.location.host +
      '/' +
      FB.guid()
    );

    // We currently disable postMessage in IE8 because it does not work with
    // window.opener. We can probably be smarter about it.
    if (window.addEventListener && window.postMessage) {
      FB.XD.PostMessage.init();
      FB.XD._transport = 'postmessage';
    } else if (FB.Flash.hasMinVersion()) {
      FB.XD.Flash.init();
      FB.XD._transport = 'flash';
    } else {
      FB.XD._transport = 'fragment';
    }
  },

  /**
   * Builds a url attached to a callback for xd messages.
   *
   * This is one half of the XD layer. Given a callback function, we generate
   * a xd URL which will invoke the function. This allows us to generate
   * redirect urls (used for next/cancel and so on) which will invoke our
   * callback functions.
   *
   * @access private
   * @param cb       {Function} the callback function
   * @param relation {String}   parent or opener to indicate window relation
   * @return        {String}   the xd url bound to the callback
   */
  handler: function(cb, relation) {
    FB.XD.init();

    // the ?=& tricks login.php into appending at the end instead
    // of before the fragment as a query string
    // FIXME
    var
      xdProxy = FB._domain.cdn + 'connect/xd_proxy.php#?=&',
      id = FB.guid();

    // in fragment mode, the url is the current page and a fragment with a
    // magic token
    if (FB.XD._transport == 'fragment') {
      xdProxy = window.location.toString();
      var poundIndex = xdProxy.indexOf('#');
      if (poundIndex > 0) {
        xdProxy = xdProxy.substr(0, poundIndex);
      }
      // fb_xd_bust changes the url to prevent firefox from refusing to load
      // because it thinks its smarter than the developer and believes it to be
      // a recusive load. the rest are explanined in the note above.
      xdProxy += '?&fb_xd_bust#?=&' + FB.XD.Fragment._magic;
    }

    FB.XD._callbacks[id] = cb;
    return xdProxy + FB.QS.encode({
      cb        : id,
      origin    : FB.XD._origin,
      relation  : relation || 'opener',
      transport : FB.XD._transport
    });
  },

  /**
   * Handles the raw or parsed message and invokes the bound callback with
   * the data and removes the related window/frame.
   *
   * @access private
   * @param data {String|Object} the message fragment string or parameters
   */
  recv: function(data) {
    if (typeof data == 'string') {
      data = FB.QS.decode(data);
    }

    var cb = FB.XD._callbacks[data.cb];
    delete FB.XD._callbacks[data.cb];
    cb && cb(data);
  },

  /**
   * Provides Native ``window.postMessage`` based XD support.
   *
   * @class FB.XD.PostMessage
   * @static
   * @for FB.XD
   * @access private
   */
  PostMessage: {
    /**
     * Initialize the native PostMessage system.
     *
     * @access private
     */
    init: function() {
      var H = FB.XD.PostMessage.onMessage;
      window.addEventListener
        ? window.addEventListener('message', H, false)
        : window.attachEvent('onmessage', H);
    },

    /**
     * Handles a message event.
     *
     * @access private
     * @param event {Event} the event object
     */
    onMessage: function(event) {
      FB.XD.recv(event.data);
    }
  },

  /**
   * Provides Flash Local Connection based XD support.
   *
   * @class FB.XD.Flash
   * @static
   * @for FB.XD
   * @access private
   */
  Flash: {
    /**
     * Initialize the Flash Local Connection.
     *
     * @access private
     */
    init: function() {
      FB.Flash.onReady(function() {
        document.XdComm.postMessage_init('FB.XD.Flash.onMessage',
                                         FB.XD._origin);
      });
    },

    /**
     * Handles a message received by the Flash Local Connection.
     *
     * @access private
     * @param message {String} the URI encoded string sent by the SWF
     */
    onMessage: function(message) {
      FB.XD.recv(decodeURIComponent(message));
    }
  },

  /**
   * Provides XD support via a fragment by reusing the current page.
   *
   * @class FB.XD.Fragment
   * @static
   * @for FB.XD
   * @access private
   */
  Fragment: {
    _magic: 'fb_xd_fragment;',

    /**
     * Check if the fragment looks like a message, and dispatch if it does.
     */
    checkAndDispatch: function() {
      var
        loc = window.location.toString(),
        fragment = loc.substr(loc.indexOf('#') + 1),
        magicIndex = fragment.indexOf(FB.XD.Fragment._magic);

      if (magicIndex > 0) {
        // make these no-op to help with performance
        //
        // this works independent of the module being present or not, or being
        // loaded before or after
        FB.init = FB.getLoginStatus = FB.api = function() {};

        // display none helps prevent loading of some stuff
        document.body.style.display = 'none';

        fragment = fragment.substr(magicIndex + FB.XD.Fragment._magic.length);
        var params = FB.QS.decode(fragment);
        // NOTE: only supporting opener, parent or top here. if needed, the
        // resolveRelation function from xd_proxy can be used to provide more
        // complete support.
        window[params.relation].FB.XD.recv(fragment);
      }
    }
  }
});

// NOTE: self executing code.
//
// if the page is being used for fragment based XD messaging, we need to
// dispatch on load without needing any API calls. it only does stuff if the
// magic token is found in the fragment.
FB.XD.Fragment.checkAndDispatch();
