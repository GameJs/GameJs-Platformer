// modulr (c) 2010 codespeaks sàrl
// Freely distributable under the terms of the MIT license.
// For details, see:
//   http://github.com/codespeaks/modulr/blob/master/LICENSE

var modulr = (function(global) {
  var _dependencyGraph = {},
      _loadingFactories = {},
      _incompleteFactories = {},
      _factories = {},
      _modules = {},
      _exports = {},
      _handlers = [],
      _dirStack = [''],
      PREFIX = '__module__', // Prefix identifiers to avoid issues in IE.
      RELATIVE_IDENTIFIER_PATTERN = /^\.\.?\//,
      _forEach,
      _indexOf;
      
  _forEach = (function() {
    var hasOwnProp = Object.prototype.hasOwnProperty,
        DONT_ENUM_PROPERTIES = [
          'constructor', 'toString', 'toLocaleString', 'valueOf',
          'hasOwnProperty','isPrototypeOf', 'propertyIsEnumerable'
        ],
        LENGTH = DONT_ENUM_PROPERTIES.length,
        DONT_ENUM_BUG = true;
    
    function _forEach(obj, callback) {
      for(var prop in obj) {
        if (hasOwnProp.call(obj, prop)) {
          callback(prop, obj[prop]);
        }
      }
    }
    
    for(var prop in { toString: true }) {
      DONT_ENUM_BUG = false
    }
    
    if (DONT_ENUM_BUG) {
      return function(obj, callback) {
         _forEach(obj, callback);
         for (var i = 0; i < LENGTH; i++) {
           var prop = DONT_ENUM_PROPERTIES[i];
           if (hasOwnProp.call(obj, prop)) {
             callback(prop, obj[prop]);
           }
         }
       }
    }
    
    return _forEach;
  })();
  
  _indexOf = (function() {
    var nativeIndexOf = Array.prototype.indexOf;
    if (typeof nativeIndexOf === 'function') {
      return function(array, item) {
        return nativeIndexOf.call(array, item);
      }
    }
    
    return function(array, item) {
      for (var i = 0, length = array.length; i < length; i++) {
        if (item === array[i]) { return i; }
      }
      return -1;
    }
  })();
  
  function require(identifier) {
    var fn, mod,
        id = resolveIdentifier(identifier),
        key = PREFIX + id,
        expts = _exports[key];
    
    if (!expts) {
      _exports[key] = expts = {};
      _modules[key] = mod = { id: id };
      
      fn = _factories[key];
      _dirStack.push(id.substring(0, id.lastIndexOf('/') + 1))
      try {
        if (!fn) { throw 'Can\'t find module "' + identifier + '".'; }
        if (typeof fn === 'string') {
          fn = new Function('require', 'exports', 'module', fn);
        }
        fn(require, expts, mod);
        _dirStack.pop();
      } catch(e) {
        _dirStack.pop();
        // We'd use a finally statement here if it wasn't for IE.
        throw e;
      }
    }
    return expts;
  }
  
  function resolveIdentifier(identifier) {
    var dir, parts, part, path;
    
    if (!RELATIVE_IDENTIFIER_PATTERN.test(identifier)) {
      return identifier;
    }
    dir = _dirStack[_dirStack.length - 1];
    parts = (dir + identifier).split('/');
    path = [];
    for (var i = 0, length = parts.length; i < length; i++) {
      part = parts[i];
      switch (part) {
        case '':
        case '.':
          continue;
        case '..':
          path.pop();
          break;
        default:
          path.push(part);
      }
    }
    return path.join('/');
  }
  
  function define(descriptors, dependencies) {
    var missingDependencies;
    if (dependencies) {
      // Check to see if any of the required dependencies 
      // weren't previously loaded.
      // Build an array of missing dependencies with those which weren't.
      for (var i = 0, length = dependencies.length; i < length; i++) {
        var key = PREFIX + dependencies[i];
        if (!(key in _factories) && !(key in _incompleteFactories)) {
          missingDependencies = missingDependencies || [];
          missingDependencies.push(key);
        }
      }
    }
    
    if (missingDependencies) {
      // Add each newly defined descriptor to our list of
      // factories missing dependencies.
      // Build a dependency graph so we can handle subsequent 
      // require.define calls easily.
      _forEach(descriptors, function(id, factory) {
        var identifier = resolveIdentifier(id);
        var key = PREFIX + identifier;
        _dependencyGraph[key] = missingDependencies; // TODO clone?
        _incompleteFactories[key] = factory;
      });
      // load the missing modules.
      loadModules(missingDependencies);
    } else {
      // There aren't any missing dependencies in the factories
      // which were just defined. Lets move them to a list of
      // synchronously requirable factories.
      prepare(descriptors);
      // While we're at it, let's call all async handlers whose
      // dependencies are now available.
      callRipeHandlers();
    }
  }
  
  function prepare(descriptors) {
    // Handles factories for which all dependencies are
    // available.
    _forEach(descriptors, function(id, factory) {
      var identifier = resolveIdentifier(id);
      var key = PREFIX + identifier;
      // Move the factory from the list of factories missing
      // dependencies to the list of synchronously requirable
      // factories.
      _factories[key] = factory;
      delete _incompleteFactories[key];
      // Go through the dependency graph and remove the factory
      // from all of the missing dependencies lists.
      _forEach(_dependencyGraph, function(unused, dependencies) {
        var i = _indexOf(i, key);
        if (i > -1) { dependencies.splice(i, 1); }
      });
    });
    
    // Find all the factories which no longer have missing dependencies.
    var newFactories;
    _forEach(_dependencyGraph, function(key, dependencies) {
      if (dependencies.length === 0) {
        newFactories = newFactories || {};
        newFactories[key] = _incompleteFactories[key];
        delete _dependencyGraph[key];
      }
    });
    // recurse!
    if (newFactories) { prepare(newFactories); }
  }
  
  function ensure(dependencies, callback, errorCallback) {
    // Cache this new handler.
    _handlers.push({
      dependencies: dependencies,
      callback: callback,
      errorCallback: errorCallback
    });
    
    // Immediately callRipeHandlers(): you never know,
    // all of the required dependencies might be already
    // available.
    callRipeHandlers();
  }
  
  function callRipeHandlers() {
    var missingFactories;
    
    for (var i = 0, length = _handlers.length; i < length; i++) {
      // Go through all of the stored handlers.
      var handler = _handlers[i],
          dependencies = handler.dependencies,
          isRipe = true;
      for (var j = 0, reqLength = dependencies.length; j < reqLength; j++) {
        var id = dependencies[j];
        // If any dependency is missing, the handler isn't ready to be called.
        // Store those missing so we can later inform the loader.
        var identifier = resolveIdentifier(id);
        if (!_factories[PREFIX + identifier]) {
          missingFactories = missingFactories || [];
          if (_indexOf(missingFactories, identifier) < 0) {
            missingFactories.push(identifier);
          }
          isRipe = false;
        }
      }
      
      if (isRipe) {
        handler.callback(); // TODO error handling
      }
    }
    
    if (missingFactories) {
      loadModules(missingFactories);
    }
  }
  
  function loadModules(factories) {
    var missingFactories;
    for (var i = 0, length = factories.length; i < length; i++) {
      var factory = factories[i];
      if (!(factory in _loadingFactories)) {
        missingFactories = missingFactories || [];
        missingFactories.push(factory);
      }
    }
    if (missingFactories) {
      console.log(missingFactories);
    }
  }
  
  require.define = define;
  require.ensure = ensure;
  require.main = {};
  
  return {
    require: require
  };
})(this);

(function(require, module) { require.define({
'gamejs': function(require, exports, module) {
var matrix = require('gamejs/utils/matrix');
var objects = require('gamejs/utils/objects');

/**
 * @fileoverview This module holds the essential `Rect` and `Surface` classes as
 * well as static methods for preloading assets. `gamejs.ready()` is maybe
 * the most important as it kickstarts your app.
 *
 */

var DEBUG_LEVELS = ['info', 'warn', 'error', 'fatal'];
var debugLevel = 2;

/**
 * set logLevel as string or number
 * 0 = debug; 1 = warn; 2 = error;
 *
 * @example
 * gamejs.setLogLevel(0); // debug
 * gamejs.setLogLevel('error'); // equal to setLogLevel(2)
 */
exports.setLogLevel = function(logLevel) {
   if (typeof logLevel === 'string' && DEBUG_LEVELS.indexOf(logLevel)) {
      debugLevel = DEBUG_LEVELS.indexOf(logLevel);
   } else if (typeof logLevel === 'number') {
      debugLevel = logLevel;
   } else {
      throw new Error('invalid logLevel ', logLevel, ' Must be one of: ', DEBUG_LEVELS);
   }
   return debugLevel;
};
/**
 * Log a msg to the console if console is enable
 * @param {String} msg the msg to log
 */
var log = exports.log = function() {
   // IEFIX can't call apply on console
   var args = Array.prototype.slice.apply(arguments, [0]);
   args.unshift(Date.now());
   if (window.console !== undefined && console.log.apply) console.log.apply(console, args);
};
exports.debug = function() {
   if (debugLevel > 0) return;
   log.apply(this, arguments);
};
exports.warn = function() {
   if (debugLevel > 1) return;
   log.apply(this, arguments);
};
exports.error = function() {
   if (debugLevel > 2) return;
   log.apply(this, arguments);
};

/**
 * Normalize various ways to specify a Rect into {left, top, width, height} form.
 *
 */
function normalizeRectArguments() {
   var left = 0;
   var top = 0;
   var width = 0;
   var height = 0;

   if (arguments.length === 2) {
      if (arguments[0] instanceof Array && arguments[1] instanceof Array) {
         left = arguments[0][0];
         top = arguments[0][1];
         width = arguments[1][0];
         height = arguments[1][1];
      } else {
         left = arguments[0];
         top = arguments[1];
      }
   } else if (arguments.length === 1 && arguments[0] instanceof Array) {
      left = arguments[0][0];
      top = arguments[0][1];
      width = arguments[0][2];
      height = arguments[0][3];
   } else if (arguments.length === 1 && arguments[0] instanceof Rect) {
      left = arguments[0].left;
      top = arguments[0].top;
      width = arguments[0].width;
      height = arguments[0].height;
   } else if (arguments.length === 4) {
      left = arguments[0];
      top = arguments[1];
      width = arguments[2];
      height = arguments[3];
   } else {
      throw new Error('not a valid rectangle specification');
   }
   return {left: left || 0, top: top || 0, width: width || 0, height: height || 0};
};

/**
 * Creates a Rect. Rects are used to hold rectangular areas. There are a couple
 * of convinient ways to create Rects with different arguments and defaults.
 *
 * Any function that requires a `gamejs.Rect` argument also accepts any of the
 * constructor value combinations `Rect` accepts.
 *
 * Rects are used a lot. They are good for collision detection, specifying
 * an area on the screen (for blitting) or just to hold an objects position.
 *
 * `left`, `top`, `width`, `height`, and `center` are assignable.
 *
 * `bottom` and `right` are read-only for now.
 *
 * @example
 * new Rect([left, top]) width & height default to 0
 * new Rect(left, top) width & height default to 0
 * new Rect(left, top, width, height)
 * new Rect([left, top], [width, height])
 * new Rect(oldRect) clone of oldRect is created
 *
 * @property {Number} left
 * @property {Number} right
 * @property {Number} top
 * @property {Number} bottom
 * @property {Number} center
 *
 * @param {Array|gamejs.Rect} position Array holding left and top coordinates
 * @param {Array} dimensions Array holding width and height
 */
var Rect = exports.Rect = function() {

   var args = normalizeRectArguments.apply(this, arguments);

   /**
    * Left, X coordinate
    * @name Rect.prototype.left
    * @type Number
    */
   this.left = args.left;

   /**
    * Top, Y coordinate
    * @name Rect.prototype.top
    * @type Number
    */
   this.top = args.top;

   /**
    * Width of rectangle
    * @name Rect.prototype.width
    * @type Number
    */
   this.width = args.width;

   /**
    * Height of rectangle
    * @name Rect.prototype.height
    * @type Number
    */
   this.height = args.height;

   return this;
};

objects.accessors(Rect.prototype, {
   /**
    * Bottom, Y coordinate
    * @type Number
    */
   'bottom': {
      get: function() {
         return this.top + this.height;
      },
      set: function(newValue) {
         this.top = newValue - this.height;
         return;
      }
   },
   /**
    * Right, X coordinate
    * @type Number
    */
   'right': {
      get: function() {
         return this.left + this.width;
      },
      set: function(newValue) {
         this.left = newValue - this.width;
      }
   },
   /**
    * Center Position. You can assign a rectangle form.
    * @type Array
    */
   'center': {
      get: function() {
         return [this.left + (this.width / 2),
                 this.top + (this.height / 2)
                ];
      },
      set: function() {
         var args = normalizeRectArguments.apply(this, arguments);
         this.left = args.left - (this.width / 2);
         this.top = args.top - (this.height / 2);
         return;
      }
   },

});

/**
 * Move returns a new Rect, which is a version of this Rect
 * moved by the given amounts. Accepts any rectangle form.
 * as argument.
 *
 * @param {Number|gamejs.Rect} x amount to move on x axis
 * @param {Number} y amount to move on y axis
 */
Rect.prototype.move = function() {
   var args = normalizeRectArguments.apply(this, arguments);
   return new Rect(this.left + args.left, this.top + args.top, this.width, this.height);
};

/**
 * Move this Rect in place - not returning a new Rect like `move(x, y)` would.
 *
 * `moveIp(x,y)` or `moveIp([x,y])`
 *
 * @param {Number|gamejs.Rect} x amount to move on x axis
 * @param {Number} y amount to move on y axis
 */
Rect.prototype.moveIp = function() {
   var args = normalizeRectArguments.apply(this, arguments);
   this.left += args.left;
   this.top += args.top;
   return;
};

/**
 * Check for collision with a point.
 *
 * `collidePoint(x,y)` or `collidePoint([x,y])` or `collidePoint(new Rect(x,y))`
 *
 * @param {Array|gamejs.Rect} point the x and y coordinates of the point to test for collision
 * @returns {Boolean} true if the point collides with this Rect
 */
Rect.prototype.collidePoint = function() {
   var args = normalizeRectArguments.apply(this, arguments);
   return (this.left <= args.left && args.left <= this.right) &&
       (this.top <= args.top && args.top <= this.bottom)
};

/**
 * Check for collision with a Rect.
 * @param {gamejs.Rect} rect the Rect to test check for collision
 * @returns {Boolean} true if the given Rect collides with this Rect
 */
Rect.prototype.collideRect = function(rect) {
   return !(this.left > rect.right || this.right < rect.left ||
      this.top > rect.bottom || this.bottom < rect.top);
};

/**
 * @param {Array} pointA start point of the line
 * @param {Array} pointB end point of the line
 * @returns true if the line intersects with the rectangle
 * @see http://stackoverflow.com/questions/99353/how-to-test-if-a-line-segment-intersects-an-axis-aligned-rectange-in-2d/293052#293052
 *
 */
Rect.prototype.collideLine = function(p1, p2) {
  var x1 = p1[0];
  var y1 = p1[1];
  var x2 = p2[0];
  var y2 = p2[1];

  function linePosition(point) {
    var x = point[0]
      var y = point[1];
    return (y2 - y1) * x + (x1 - x2) * y + (x2 * y1 - x1 * y2);
  }

  var relPoses = [[this.left, this.top],
      [this.left, this.bottom],
      [this.right, this.top],
      [this.right, this.bottom]
        ].map(linePosition);

  var noNegative = true;
  var noPositive = true;
  var noZero = true;
  relPoses.forEach(function(relPos) {
    if (relPos > 0) noPositive = false;
    if (relPos < 0) noNegative = false;
    if (relPos === 0) noZero = false;
  }, this);

  if ( (noNegative || noPositive) && noZero) {
    return false;
  }
  return !((x1 > this.right && x2 > this.right) ||
      (x1 < this.left && x2 < this.left) ||
      (y1 < this.top && y2 < this.top) ||
      (y1 > this.bottom && y2 > this.bottom)
      );
}

/**
 * @returns {String} Like "[x, y][w, h]"
 */
Rect.prototype.toString = function() {
  return ["[", this.left, ",", this.top, "]"," [",this.width, ",", this.height, "]"].join("");
}

/**
 * @returns {gamejs.Rect} A new copy of this rect
 */
Rect.prototype.clone = function() {
  return new Rect(this);
};

/**
 * A Surface represents a bitmap image with a fixed width and height. The
 * most important feature of a Surface is that they can be `blitted`
 * onto each other.
 *
 * @example
 * new gamejs.Surface([width, height]);
 * new gamejs.Surface(width, height);
 * new gamejs.Surface(rect);
 * @constructor
 *
 * @param {Array} dimensions Array holding width and height
 */
var Surface = exports.Surface = function() {
  var args = normalizeRectArguments.apply(this, arguments);
  var width = args.left;
  var height = args.top;
  // unless argument is rect:
  if (arguments.length == 1 && arguments[0] instanceof Rect) {
    width = args.width;
    height = args.height;
  }
  // only for rotatation & scale
  /** @ignore */
  this._matrix = matrix.identity();
  /** @ignore */
  this._canvas = document.createElement("canvas");
  this._canvas.width = width;
  this._canvas.height = height;
  /** @ignore */
  this._blitAlpha = 1.0;

  // disable gecko image scaling
  // see https://developer.mozilla.org/en/Canvas_tutorial/Using_images#Controlling_image_scaling_behavior
  // this.context.mozImageSmoothingEnabled = false;
  return this;
};

/**
 * Blits another Surface on this Surface. The destination where to blit to
 * can be given (or it defaults to the top left corner) as well as the
 * Area from the Surface which should be blitted (e.g., for cutting out parts of
 * a Surface).
 *
 * @example
 * // blit flower in top left corner of display
 * displaySurface.blit(flowerSurface);
 *
 * // position flower at 10/10 of display
 * displaySurface.blit(flowerSurface, [10, 10])
 *
 * // ... `dest` can also be a rect whose topleft position is taken:
 * displaySurface.blit(flowerSurface, new gamejs.Rect([10, 10]);
 *
 * // only blit half of the flower onto the display
 * var flowerRect = flowerSurface.rect;
 * flowerRect = new gamejs.Rect([0,0], [flowerRect.width/2, flowerRect.height/2])
 * displaySurface.blit(flowerSurface, [0,0], flowerRect);
 *
 * @param {gamejs.Surface} src The Surface which will be blitted onto this one
 * @param {gamejs.Rect|Array} dst the Destination x, y position in this Surface.
 *            If a Rect is given, it's top and left values are taken. If this argument
 *            is not supplied the blit happens at [0,0].
 * @param {gamesjs.Rect|Array} area the Area from the passed Surface which
 *            should be blitted onto this Surface.
 * @param {Number} [special_flags] FIXME add special flags for composite operations
 */
Surface.prototype.blit = function(src, dest, area, special_flags) {

  var rDest, rArea;

  // dest, we only care about x, y
  if (dest instanceof Rect) {
    rDest = dest.clone(); // new gamejs.Rect([dest.left, dest.top], src.getSize());
    var srcSize = src.getSize();
    if (!rDest.width) rDest.width = srcSize[0];
    if (!rDest.height) rDest.height = srcSize[1];
  } else if (dest && dest instanceof Array && dest.length == 2) {
    rDest = new Rect(dest, src.getSize());
  } else {
    rDest = new Rect([0,0], src.getSize());
  }

  // area within src to be drawn
  if (area instanceof Rect) {
    rArea = area;
  } else if (area && area instanceof Array && area.length == 2) {
    rArea = new Rect(area, src.getSize());
  } else {
    rArea = new Rect([0,0], src.getSize());
  }

  if (isNaN(rDest.left) || isNaN(rDest.top) || isNaN(rDest.width) || isNaN(rDest.height)) {
    throw new Error('[blit] bad parameters, destination is ' + rDest);
  }

  this.context.save();
  // first translate, then rotate
  var m = matrix.translate(matrix.identity(), rDest.left, rDest.top);
  m = matrix.multiply(m, src._matrix);
  this.context.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  srcRect = src.getRect();
  // drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
  this.context.globalAlpha = src._blitAlpha;
  this.context.drawImage(src.canvas, rArea.left, rArea.top, rArea.width, rArea.height, 0, 0, rDest.width, rDest.height)
    this.context.restore();
  return;
};

/**
 * @returns {Number[]} the width and height of the Surface
 */
Surface.prototype.getSize = function() {
  return [this.canvas.width, this.canvas.height];
};

/**
 * Obsolte, only here for compatibility.
 * @deprecated
 * @ignore
 * @returns {gamejs.Rect} a Rect of the size of this Surface
 */
Surface.prototype.getRect = function() {
  return new Rect([0,0], this.getSize());
};

/**
 * Fills the whole Surface with a color. Usefull for erasing a Surface.
 * @param {String} CSS color string, e.g. '#0d120a' or '#0f0' or 'rgba(255, 0, 0, 0.5)'
 */
Surface.prototype.fill = function(color) {
  this.context.save();
  this.context.fillStyle = color || "#000000";
  this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
  this.context.restore();
  return;
};

/**
 * Clear the surface.
 */
Surface.prototype.clear = function() {
  var size = this.getSize();
  this.context.clearRect(0, 0, size[0], size[1]);
  return;
};

objects.accessors(Surface.prototype, {
  /**
   * @type gamejs.Rect
   */
  'rect': {
    get: function() {
           return this.getRect();
         }
  },
  /**
   * @ignore
   */
  'context': {
    get: function() {
           return this._canvas.getContext('2d');
         }
  },
  'canvas': {
    get: function() {
           return this._canvas;
         }
  },
});

/**
 * @returns {gamejs.Surface} a clone of this surface
 */
Surface.prototype.clone = function() {
  var newSurface = new Surface(this.getRect());
  newSurface.blit(this);
  return newSurface;
};

/**
 * @returns {Number} current alpha value
 */
Surface.prototype.getAlpha = function() {
  return (1 - this._blitAlpha);
};

/**
 * Set the alpha value for the whole Surface. When blitting the Surface on
 * a destination, the pixels will be drawn slightly transparent.
 * @param {Number} alpha value in range 0.0 - 1.0
 * @returns {Number} current alpha value
 */
Surface.prototype.setAlpha = function(alpha) {
  if (isNaN(alpha) || alpha < 0 || alpha > 1) return;

  this._blitAlpha = (1 - alpha);
  return (1 - this._blitAlpha);
};

/**
 * The data must be represented in left-to-right order, row by row top to bottom,
 * starting with the top left, with each pixel's red, green, blue, and alpha components
 * being given in that order for each pixel.
 * @see http://dev.w3.org/html5/2dcontext/#canvaspixelarray
 * @returns {Array} the pixel image data (the canvas pixel array in html speak)
 */
Surface.prototype.getImageData = function() {
  var size = this.getSize();
  return this.context.getImageData(0, 0, size[0], size[1]).data;
};

/**
 * @ignore
 */
exports.display = require('gamejs/display');
/**
 * @ignore
 */
exports.draw = require('gamejs/draw');
/**
 * @ignore
 */
exports.event = require('gamejs/event');
/**
 * @ignore
 */
exports.font = require('gamejs/font');
/**
 * @ignore
 */
exports.http = require('gamejs/http');
/**
 * @ignore
 */
exports.image = require('gamejs/image');
/**
 * @ignore
 */
exports.mask = require('gamejs/mask');
/**
 * @ignore
 */
exports.mixer = require('gamejs/mixer');
/**
 * @ignore
 */
exports.sprite = require('gamejs/sprite');
/**
 * @ignore
 */
exports.surfacearray = require('gamejs/surfacearray');
/**
 * @ignore
 */
exports.time = require('gamejs/time');
/**
 * @ignore
 */
exports.transform = require('gamejs/transform');

/**
 * @ignore
 */
exports.utils = {
  arrays: require('gamejs/utils/arrays'),
  objects: require('gamejs/utils/objects'),
  matrix: require('gamejs/utils/matrix')
};

/**
 * @ignore
 */
exports.pathfinding = {
  astar: require('gamejs/pathfinding/astar')
};

// preloading stuff
var gamejs = require('gamejs');
var RESOURCES = {};

/**
 * ReadyFn is called once all modules and assets are loaded.
 * @param {Function} readyFn the function to be called once gamejs finished loading
 * @name ready
 */
exports.ready = function(readyFn) {
  // 2.
  var _ready = function() {
    if (!document.body) {
      return window.setTimeout(_ready, 13);
    }
    gamejs.image.preload(RESOURCES);
    try {
      gamejs.mixer.preload(RESOURCES);
    } catch (e) {
      gamejs.debug('Error loading image files ', e);
    }
    window.setTimeout(_readyResources, 13);
  }
  // 3.
  var _readyResources = function() {
    if (gamejs.image.isPreloading() || gamejs.mixer.isPreloading()) {
      return window.setTimeout(_readyResources, 13);
    }
    gamejs.time.init();
    gamejs.display.init();
    gamejs.image.init();
    gamejs.mixer.init();
    gamejs.event.init();
    readyFn();
  }

  // 1.
  window.setTimeout(_ready, 13);
  return;
};

/**
 * Preload resources.
 * @param {Array} resources list of resources paths
 * @name preload
 */
var preload = exports.preload = function(resources) {
  // attack appBaseUrl to resources
  resources.forEach(function(res) {
    // normalize slashses
    RESOURCES[res] = ($g.resourceBaseHref + '/' + res).replace(/\/+/g, '/');
  }, this);
  return;
};

},
  'gamejs/utils/matrix': function(require, exports, module) {
    /**
     * @fileoverview Matrix manipulation, used by GameJs itself. You
     * probably do not need this unless you manipulate a Context's transformation
     * matrix yourself.
     */

    // correct way to do scale, rotate, translate
    // *  gamejs.utils.matrix will be used in gamejs.transforms, modifing the surfaces.matrix
    // * this matrix must be applied to the context in Surface.draw()


    var identiy = exports.identity = function () {
      return [1, 0, 0, 1, 0, 0];
    };

    var add = exports.add = function(m1, m2) {
      return [
        m1[0] + m2[0],
        m1[1] + m2[1],
        m1[2] + m2[2],
        m1[3] + m2[3],
        m1[4] + m2[4],
        m1[5] + m2[5],
        m1[6] + m2[6]
          ];
    };

    var multiply = exports.multiply = function(m1, m2) {
      return [
        m1[0] * m2[0] + m1[2] * m2[1],
        m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3],
        m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
        m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
        ];
    };

    var translate = exports.translate = function(m1, dx, dy) {
      return multiply(m1, [1, 0, 0, 1, dx, dy]);
    };

    var rotate = exports.rotate = function(m1, angle) {
      // radians
      var sin = Math.sin(angle);
      var cos = Math.cos(angle);
      return multiply(m1, [cos, sin, -sin, cos, 0, 0]);
    };

    // get current rotation in rads
    var rotation = exports.rotation = function(m1) {
      return Math.atan2(m1[1], m1[0]);
    };

    var scale = exports.scale = function(m1, svec) {
      var sx = svec[0];
      var sy = svec[1];
      return multiply(m1, [sx, 0, 0, sy, 0, 0]);
    };

  },
  'gamejs/utils/objects': function(require, exports, module) {
    /**
     * @fileoverview Utility functions for working with Objects
     */

    /**
     * Put a prototype into the prototype chain of another prototype.
     * @param {Object} subClass
     * @param {Object} superClass
     */
    exports.extend = function(subClass, superClass) {
      if (subClass === undefined) throw new Error('unknown subClass');
      if (superClass === undefined) throw new Error('unknown superClass');

      var f = new Function();
      f.prototype = superClass.prototype;

      subClass.prototype = new f();
      subClass.prototype.constructor = subClass;
      subClass.superClass = superClass.prototype;
      subClass.superConstructor = superClass;
      return;
    };

    /**
     * Creates a new object as the as the keywise union of the provided objects.
     * Whenever a key exists in a later object that already existed in an earlier
     * object, the according value of the earlier object takes precedence.
     * @param {Object} obj... The objects to merge
     */
    exports.merge = function() {
      var result = {};
      for (var i = arguments.length; i > 0; --i) {
        var obj = arguments[i - 1];
        for (var property in obj) {
          result[property] = obj[property];
        }
      }
      return result;
    };

    /**
     * fallback for Object.keys
     * @param {Object} obj
     * @returns {Array} list of own properties
     * @see https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Object/keys
     */
    var keys = exports.keys = function(obj) {
      if (Object.keys) return Object.keys(obj);

      var ret=[],p;
      for (p in obj) {
        if(Object.prototype.hasOwnProperty.call(obj, p)) {
          ret.push(p);
        }
      }
      return ret;
    }
    /**
     * Create object accessors
     * @param {Object} object The object on which to define the property
     * @param {String} name name of the property
     * @param {Function} get
     * @param {Function} set
     * @see https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Object/defineProperty
     */
    var accessor = exports.accessor = function(object, name, get, set) {
      // ECMA5
      if (Object.defineProperty !== undefined) {
        Object.defineProperty(object, name, {
          get: get,
          set: set
        });
        // non-standard
      } else if (Object.prototype.__defineGetter__ !== undefined) {
        object.__defineGetter__(name, get);
        if (set) {
          object.__defineSetter__(name, set);
        }
      }
      return;
    };

    /**
     * @param {Object} object The object on which to define or modify properties.
     * @param {Object} props An object whose own enumerable properties constitute descriptors for the properties to be defined or modified.
     * @see https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Object/defineProperties
     */
    exports.accessors = function(object, props) {
      keys(props).forEach(function(propKey) {
        accessor(object, propKey, props[propKey].get, props[propKey].set);
      });
      return;
    };


  },
  'gamejs/display': function(require, exports, module) {
    var Surface = require('gamejs').Surface;

    /**
     * @fileoverview Methods to create, access and manipulate the display Surface.
     *
     * @example
     * var display = gamejs.display.setMode([800, 600]);
     * // blit sunflower picture in top left corner of display
     * var sunflower = gamejs.image.load("images/sunflower");
     * display.blit(sunflower);
     *
     */

    var CANVAS_ID = "jsgamecanvas";
    var SURFACE = null;

    /**
     * Create the master Canvas plane.
     * @ignore
     */
    exports.init = function() {
      // create canvas element if not yet present
      var jsGameCanvas = null;
      if ((jsGameCanvas = getCanvas()) === null) {
        jsGameCanvas = document.createElement("canvas");
        jsGameCanvas.setAttribute("id", CANVAS_ID);
        document.body.appendChild(jsGameCanvas);
      };
      //jsGameCanvas.setAttribute("style", "width:95%;height:85%");
      return;
    };

    /**
     * Set the width and height of the Display. Conviniently this will
     * return the actual display Surface - the same as calling [gamejs.display.getSurface()](#getSurface))
     * later on.
     * @param {Array} [width, height] of the display surface
     */
    exports.setMode = function(rect) {
      var canvas = getCanvas();
      canvas.width = rect[0];
      canvas.height = rect[1];
      return getSurface();
    };

    /**
     * Set the Caption of the Display (document.title)
     * @param {String} title the title of the app
     * @param {gamejs.Image} icon FIXME implement favicon support
     */
    exports.setCaption = function(title, icon) {
      document.title = title;
    };


    /**
     * The Display (the canvas element) is most likely not in the top left corner
     * of the browser due to CSS styling. To calculate the mouseposition within the
     * canvas we need this offset.
     * @see {gamejs.event}
     * @ignore
     *
     * @returns {Array} [x, y] offset of the canvas
     */

    exports._getCanvasOffset = function() {
      var boundRect = getCanvas().getBoundingClientRect();
      return [boundRect.left, boundRect.top];
    };

    /**
     * Drawing on the Surface returned by `getSurface()` will draw on the screen.
     * @returns {gamejs.Surface} the display Surface
     */
    var getSurface = exports.getSurface = function() {
      if (SURFACE == null) {
        var canvas = getCanvas();
        var SURFACE = new Surface([canvas.clientWidth, canvas.clientHeight]);
        SURFACE._canvas = canvas;
      }
      return SURFACE;
    };

    /**
     * @returns {document.Element} the canvas dom element
     */
    var getCanvas = function() {
      var jsGameCanvas = null;
      var canvasList = Array.prototype.slice.call(document.getElementsByTagName("canvas"));
      canvasList.every(function(canvas) {
        if (canvas.getAttribute("id") == CANVAS_ID) {
          jsGameCanvas = canvas;
          return false;
        }
        return true;
      });
      return jsGameCanvas;
    };

  },
  'gamejs/draw': function(require, exports, module) {
    /**
     * @fileoverview Utilities for drawing geometrical objects to Surfaces. If you want to put images on
     * the screen see `gamejs.image`.
     *
     * ### Colors
     * There are several ways to specify colors. Whenever the docs says "valid #RGB string"
     * you can pass in any of those formats:
     *
     *     "#ff00ff"
     *     "rgb(255, 0, 255)"
     *     "rgba(255,0, 255, 1)"
     */

    // FIXME all draw functions must return a minimal rect containing the drawn shape

    /**
     * @param {gamejs.Surface} surface the Surface to draw on
     * @param {String} a valid #RGB string, e.g., "#ff0000"
     * @param {Array} startPos [x, y] position of line start
     * @param {Array} endPos [x, y] position of line end
     * @param {Number} width of the line, defaults to 1
     */
    exports.line = function(surface, color, startPos, endPos, width) {
      var ctx = surface.context;
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width || 1;
      ctx.moveTo(startPos[0], startPos[1]);
      ctx.lineTo(endPos[0], endPos[1]);
      ctx.stroke();
      ctx.restore();
      return;
    };

    /**
     * Draw connected lines. Use this instead of indiviudal line() calls for
     * better performance
     *
     * @param {gamejs.Surface} surface the Surface to draw on
     * @param {String} color a valid #RGB string, "#ff0000"
     * @param {Boolean} closed if true the last and first point are connected
     * @param {Array} pointlist holding array [x,y] arrays of points
     * @param {Number} width width of the lines, defaults to 1
     */
    exports.lines = function(surface, color, closed, pointlist, width) {
      var closed = closed || false;
      var ctx = surface.context;
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = ctx.fillStyle = color;
      ctx.lineWidth = width || 1;
      for (var i=0;i<pointlist.length;i++) {
        var point = pointlist[i];
        if (i === 0) {
          ctx.moveTo(point[0], point[1]);
        } else {
          ctx.lineTo(point[0], point[1]);
        }
      }
      if (closed) {
        ctx.lineTo(pointlist[0][0], pointlist[0][1]);
      }
      ctx.stroke();
      ctx.restore();
      return;
    };

    /**
     * Draw a circle on Surface
     *
     * @param {gamejs.Surface} surface the Surface to draw on
     * @param {String} color a valid #RGB String, #ff00cc
     * @param {Array} pos [x, y] position of the circle center
     * @param {Number} radious of the circle
     * @param {Number} width width of the circle, if not given or 0 the circle is filled
     */
    exports.circle = function(surface, color, pos, radius, width) {
      if (!radius) throw new Error('[circle] radius required argument');
      if (!pos || !typeof(pos) === 'array') throw new Error('[circle] pos must be given & array' + pos);

      var ctx = surface.context;
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = ctx.fillStyle = color;
      ctx.lineWidth = width || 1;
      ctx.arc(pos[0], pos[1], radius, 0, 2*Math.PI, true);
      if (width === undefined || width === 0) {
        ctx.fill();
      } else {
        ctx.stroke();
      }
      ctx.restore();
      return;
    };

    /**
     * @param {gamejs.Surface} surface the Surface to draw on
     * @param {String} color a valid #RGB String, #ff00cc
     * @param {gamejs.Rect} rect the position and dimension attributes of this Rect will be used
     * @param {Number} width the width of line drawing the Rect, if 0 or not given the Rect is filled.
     */
    exports.rect = function(surface, color, rect, width) {
      var ctx =surface.context;
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = color;
      if (isNaN(width) || width === 0) {
        ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
      } else {
        ctx.lineWidth = width;
        ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
      }
      ctx.restore();
    };

    exports.arc= function(surface, color, rect, startAngle, stopAngle, width) {
      var ctx = surface.context;
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = color;
      ctx.arc(rect.center[0], rect.center[1],
          rect.width/2,
          startAngle * (Math.PI/180), stopAngle * (Math.PI/180), false
          );
      if (isNaN(width) || width === 0) {
        ctx.fill();
      } else {
        ctx.lineWidth = width;
        ctx.stroke();
      }
      ctx.restore();
    };

    /**
     * Draw a polygon on the surface. The pointlist argument are the vertices
     * for the polygon.
     *
     * @param {gamejs.Surface} surface the Surface to draw on
     * @param {String} color a valid #RGB String, #ff00cc
     * @param {Array} pointlist array of vertices [x, y] of the polygon
     * @param {Number} width the width of line, if 0 or not given the polygon is filled.
     */
    exports.polygon = function(surface, color, pointlist, width) {
      this.lines(surface, color, true, pointlist, width);
    };

  },
  'gamejs/event': function(require, exports, module) {
    var display = require('gamejs/display');
    var gamejs = require('gamejs');

    /**
     * @fileoverview Methods for polling mouse, keyboard and ntwork;
     *
     * Call get() in your main loop to get a list of events that happend since you last called.
     *
     *
     * A pattern for using this might look like so: your main game function (tick in this example)
     * is being called by [gamejs.time.fpsCallback()](../time/#fpsCallback) 25 times per second.
     * Inside tick we call [gamejs.event.get()](#get) for a list of events that happened since the last
     * tick and we loop over each event and act on the event properties.
     *
     *     var events = gamejs.event.get()
     *     events.forEach(function(event) {
     *        if (event.type === gamejs.event.MOUSE_UP) {
     *          gamejs.log(event.pos, event.button);
     *        } else if (event.type === gamejs.event.KEY_UP) {
     *          gamejs.log(event.key);
     *        }
     *     });
     *
     */
    // key constants
    exports.K_UP = 38;
    exports.K_DOWN = 40;
    exports.K_RIGHT = 39;
    exports.K_LEFT = 37;

    exports.K_SPACE = 32;
    exports.K_TAB = 9;
    exports.K_ENTER = 13;
    exports.K_CTRL = 17;
    exports.K_ALT = 18;
    exports.K_ESC = 27;

    exports.K_0 = 48;
    exports.K_1 = 49;
    exports.K_2 = 50;
    exports.K_3 = 51;
    exports.K_4 = 52;
    exports.K_5 = 53;
    exports.K_6 = 54;
    exports.K_7 = 55;
    exports.K_8 = 56;
    exports.K_9 = 57;
    exports.K_a = 65;
    exports.K_b = 66;
    exports.K_c = 67;
    exports.K_d = 68;
    exports.K_e = 69;
    exports.K_f = 70;
    exports.K_g = 71;
    exports.K_h = 72;
    exports.K_i = 73;
    exports.K_j = 74;
    exports.K_k = 75;
    exports.K_l = 76;
    exports.K_m = 77;
    exports.K_n = 78;
    exports.K_o = 79;
    exports.K_p = 80;
    exports.K_q = 81;
    exports.K_r = 82;
    exports.K_s = 83;
    exports.K_t = 84;
    exports.K_u = 85;
    exports.K_v = 86;
    exports.K_w = 87;
    exports.K_x = 88;
    exports.K_y = 89;
    exports.K_z = 90;

    exports.K_KP1 = 97;
    exports.K_KP2 = 98;
    exports.K_KP3 = 99;
    exports.K_KP4 = 100;
    exports.K_KP5 = 101;
    exports.K_KP6 = 102;
    exports.K_KP7 = 103;
    exports.K_KP8 = 104;
    exports.K_KP9 = 105;

    // event type constants
    exports.QUIT = 0;
    exports.KEY_DOWN = 1;
    exports.KEY_UP = 2;
    exports.MOUSE_MOTION = 3;
    exports.MOUSE_UP = 4
      exports.MOUSE_DOWN = 5;
    exports.MOUSE_WHEEL = 6;

    var QUEUE = [];

    /**
     * Get all events from the event queue
     * @returns {Array}
     */
    exports.get = function() {
      return QUEUE.splice(0, QUEUE.length);
    };

    /**
     * Get the newest event of the event queue
     * @returns {gamejs.event.Event}
     */
    exports.poll = function() {
      return QUEUE.pop();
    };

    /**
     * Post an event to the event queue.
     * @param {gamejs.event.Event} userEvent the event to post to the queue
     */
    exports.post = function(userEvent) {
      QUEUE.push(userEvent);
      return;
    };

    /**
     * Holds all information about an event.
     * @class
     */

    exports.Event = function() {
      /**
       * The type of the event. e.g., gamejs.event.QUIT, KEYDOWN, MOUSEUP.
       */
      this.type = null;
      /**
       * key the keyCode of the key. compare with gamejs.event.K_a, gamejs.event.K_b,...
       */
      this.key = null;
      /**
       * relative movement for a mousemove event
       */
      this.rel = null;
      /**
       * the number of the mousebutton pressed
       */
      this.button = null;
      /**
       * pos the position of the event for mouse events
       */
      this.pos = null;
    };

    /**
     * @ignore
     */
    exports.init = function() {

      // anonymous functions as event handlers = memory leak, see MDC:elementAddEventListener

      function onMouseDown (ev) {
        var canvasOffset = display._getCanvasOffset();
        QUEUE.push({
          'type': gamejs.event.MOUSE_DOWN,
          'pos': [ev.clientX - canvasOffset[0], ev.clientY - canvasOffset[1]],
          'button': ev.button,
        });
      };

      function onMouseUp (ev) {
        var canvasOffset = display._getCanvasOffset();
        QUEUE.push({
          'type':gamejs.event.MOUSE_UP,
          'pos': [ev.clientX - canvasOffset[0], ev.clientY - canvasOffset[1]],
          'button': ev.button,
        });
      };

      function onKeyDown (ev) {
        var key = ev.keyCode || ev.which;
        QUEUE.push({
          'type': gamejs.event.KEY_DOWN,
          'key': key,
          'shiftKey': ev.shiftKey,
          'ctrlKey': ev.ctrlKey,
          'metaKey': ev.metaKey
        });

        if (!ev.ctrlKey && !ev.metaKey &&
            (key >= exports.K_LEFT && key <= exports.K_DOWN
             || key >= exports.K_0    && key <= exports.K_z
             || key >= exports.K_KP1  && key <= exports.K_KP9
             || key === exports.K_SPACE
             || key === exports.K_TAB
             || key === exports.K_ENTER)) {
          ev.preventDefault();
        }
      };

      function onKeyUp (ev) {
        QUEUE.push({
          'type': gamejs.event.KEY_UP,
          'key': ev.keyCode,
          'shiftKey': ev.shiftKey,
          'ctrlKey': ev.ctrlKey,
          'metaKey': ev.metaKey
        });
      };

      function onMouseMove (ev) {
        var canvasOffset = display._getCanvasOffset();
        var currentPos = [ev.clientX - canvasOffset[0], ev.clientY - canvasOffset[1]];
        var relativePos = [];
        if (lastPos.length) {
          relativePos = [
            lastPos[0] - currentPos[0],
            lastPos[1] - currentPos[1]
              ];
        }
        QUEUE.push({
          'type': gamejs.event.MOUSE_MOTION,
          'pos': currentPos,
          'rel': relativePos,
          'buttons': null, // FIXME, fixable?
          'timestamp': ev.timeStamp,
        });
        lastPos = currentPos;
        return;
      };

      function onMouseScroll(ev) {
        var canvasOffset = display._getCanvasOffset();
        var currentPos = [ev.clientX - canvasOffset[0], ev.clientY - canvasOffset[1]];
        QUEUE.push({
          type: gamejs.event.MOUSE_WHEEL,
          pos: currentPos,
          delta: ev.detail || (- ev.wheelDeltaY / 40)
        });
        return;
      }

      function onBeforeUnload (ev) {
        QUEUE.push({
          'type': gamejs.event.QUIT,
        });
        return;
      }

      // IEFIX does not support addEventListener on document itself
      // MOZFIX but in moz & opera events don't reach body if mouse outside window or on menubar
      // hook onto document.body not canvas to avoid dependancy into gamejs.display
      document.addEventListener('mousedown', onMouseDown, false);
      document.addEventListener('mouseup', onMouseUp, false);
      document.addEventListener('keydown', onKeyDown, false);
      document.addEventListener('keyup', onKeyUp, false);
      var lastPos = [];
      document.addEventListener('mousemove', onMouseMove, false);
      document.addEventListener('mousewheel', onMouseScroll, false);
      // MOZFIX
      // https://developer.mozilla.org/en/Code_snippets/Miscellaneous#Detecting_mouse_wheel_events
      document.addEventListener('DOMMouseScroll', onMouseScroll, false);
      document.addEventListener('beforeunload', onBeforeUnload, false);

    };

  },
  'gamejs/font': function(require, exports, module) {
    var Surface = require('gamejs').Surface;
    var objects = require('gamejs/utils/objects');

    /**
     * @fileoverview Methods for creating Font objects which can render text
     * to a Surface.
     *
     * Example:
     *     // create a font
     *     var font = new Font('20px monospace');
     *     // render text - this returns a surface with the text written on it.
     *     var helloSurface = font.render('Hello World')
     */

    /**
     * Create a Font to draw on the screen. The Font allows you to
     * `render()` text. Rendering text returns a Surface which
     * in turn can be put on screen.
     *
     * @constructor
     * @property {Number} fontHeight the line height of this Font
     *
     * @param {String} fontSettings a css font definition, e.g., "20px monospace"
     * @param {STring} backgroundColor valid #rgb string, "#ff00cc"
     */
    var Font = exports.Font = function(fontSettings, backgroundColor) {
      /**
       * @ignore
       */
      this.sampleSurface = new Surface([10,10]);
      this.sampleSurface.context.font = fontSettings;
      this.sampleSurface.context.textAlign = 'start';
      this.sampleSurface.context.textBaseline = 'bottom';
      return this;
    };

    /**
     * Returns a Surface with the given text on it.
     * @param {String} text the text to render
     * @param {String} color a valid #RGB String, "#ffcc00"
     * @returns {gamejs.Surface} Surface with the rendered text on it.
     */
    Font.prototype.render = function(text, color) {
      var dims = this.size(text);
      var surface = new Surface(dims);
      var ctx = surface.context;
      ctx.save();
      ctx.font = this.sampleSurface.context.font;
      ctx.textBaseline = this.sampleSurface.context.textBaseline;
      ctx.textAlign = this.sampleSurface.context.textAlign;
      ctx.fillStyle = ctx.strokeStyle = color || "#000000";
      ctx.fillText(text, 0, surface.rect.height, surface.rect.width);
      ctx.restore();
      return surface;
    };

    /**
     * Determine the width and height of the given text if rendered
     * with this Font.
     * @param {String} text the text to measure
     * @returns {Array} the [width, height] of the text if rendered with this Font
     */
    Font.prototype.size = function(text) {
      var metrics = this.sampleSurface.context.measureText(text);
      // FIXME measuretext is buggy, make extra wide
      return [metrics.width, this.fontHeight];
    };

    /**
     * Height of the font in pixels.
     */
    objects.accessors(Font.prototype, {
      'fontHeight': {
        get: function() {
               // Returns an approximate line height of the text
               return this.sampleSurface.context.measureText('M').width * 1.5;
             },
      },

    });

  },
  'gamejs/http': function(require, exports, module) {
    /**
     * @fileoverview Make synchronous http requests to your game's serverside component.
     *
     * If you have provide a `server.js` module exporiting a stick application and a `package.json`
     * then GameJs will start those listing for http calls the client-side makes.
     *
     * @see example application 'example-http'
     * @see http://github.com/hns/stick/
     */

    /**
     * Response object returned by http functions `get` and `post`. This
     * class is not instantiable.
     *
     * @param{String} responseText
     * @param {String} responseXML
     * @param {Number} status
     * @param {String} statusText
     */
    exports.Response = function() {
      /**
       * @param {String} header;
       */
      this.getResponseHeader = function(header)  {
      };
      throw new Error('response class not instantiable');
    };

    /*
     * Make http request to server-side
     * @param {String} method http method
     * @param {String} url
     * @param {String|Object} data
     * @param {String|Object} type "Accept" header value
     * @return {Response} response
     */
    var ajax = exports.ajax = function(method, url, data, type) {
      data = data || null;
      var response = new XMLHttpRequest();
      response.open(method, url, false);
      if (type) {
        response.setRequestHeader("Accept", type );
      }
      if (data instanceof Object) {
        data = JSON.stringify(data);
        response.setRequestHeader('Content-Type', 'application/json');
      }
      response.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      response.send(data);
      return response;
    };

    /**
     * Make http GET request to server-side
     * @param {String} url
     */
    var get = exports.get = function(url) {
      return ajax('GET', url);
    };

    /**
     * Make http POST request to server-side
     * @param {String} url
     * @param {String|Object} data
     * @param {String|Object} type "Accept" header value
     * @returns {Response}
     */
    var post = exports.post = function(url, data, type) {
      return ajax('POST', url, data, type);
    };

    function stringify(response) {
      // we control origin
      return eval('(' + response.responseText + ')');
    };

    /**
     * Load an object from the server-side.
     * @param {String} url
     * @return {Object} the object loaded from the server
     */
    exports.load = function(url) {
      return stringify(get($g.ajaxBaseHref + url));
    };

    /**
     * Send an object to a server-side function.
     * @param {String} url
     * @param {String|Object} data
     * @param {String|Object} type "Accept" header value
     * @returns {Object} the response object
     */
    exports.save = function(url, data, type) {
      return stringify(post($g.ajaxBaseHref + url, {payload: data}, type));
    };

  },
  'gamejs/image': function(require, exports, module) {
    var gamejs = require('gamejs');

    /**
     * @fileoverview Load images as Surfaces.
     * All images must be preloaded:
     *
     *     gamejs.preload(["images/ship.png", "images/sunflower.png"]);
     *
     * and can then be loaded as Surfaces with [gamejs.image.load](#load).
     *
     */

    var CACHE = {};
    var TOTAL_IMGS = 0;
    /**
     * need to export preloading status for require
     * @ignore
     */
    var _PRELOADING = false;

    /**
     * Load image and return it on a Surface.
     *
     * **Preloading**
     *
     * All images must be preloaded like this:
     *
     *     gamejs.preload(["./images/ship.png", "./images/sunflower.png"]);
     *
     * before they can be used within the gamejs.ready() callback.
     *
     * **Used Resources**
     *
     * This creates a new canvas DOM element each time it is called.
     *
     * @param {String|dom.Image} uriOrImage resource uri for image or the image as a DOM Element (e.g. from <img>)
     * @returns {gamejs.Surface} surface with the image on it.
     */
    exports.load = function(key) {
      var img;
      if (typeof key === 'string') {
        img = CACHE[key];
        if (!img) {
          // TODO sync image loading
          throw new Error('Missing "' + key + '", gamejs.preload() all images before trying to load them.');
        }
      } else {
        img = key;
      }
      var canvas = document.createElement('canvas');
      // IEFIX missing html5 feature naturalWidth/Height
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      var context = canvas.getContext('2d');
      //context.fillStyle = "#00ff00";
      //context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0)
        img.getSize = function() { return [img.naturalWidth, img.naturalHeight]; };
      var surface = new gamejs.Surface(img.getSize());
      // NOTE hack setting _canvas directly, don't do this yourself
      surface._canvas = canvas;
      return surface;
    };


    /**
     * add all images on the currrent page into cache
     * @ignore
     */
    exports.init = function() {
      return;
    };

    /**
     * preload the given img URIs
     * @ignore
     */
    exports.preload = function(imgIdents) {

      var countLoaded = 0;

      var incrementLoaded = function() {
        countLoaded++;
        if (countLoaded == TOTAL_IMGS) {
          _PRELOADING = false;
        }
        if (countLoaded % 10 == 0) {
          gamejs.log('loaded  ' + countLoaded + ' of ' + TOTAL_IMGS);
        }
      };
      for (var key in imgIdents) {
        if (key.indexOf('png') == -1 && key.indexOf('jpg') == -1 && key.indexOf('gif') == -1) {
          continue;
        }
        TOTAL_IMGS++;
        var img = new Image();
        img.addEventListener('load',function() {
          addToCache(this);
          incrementLoaded();
          return;
        }, true);
        img.addEventListener('error', function() {
          incrementLoaded();
          throw new Error('Error loading ' + this.src);
          return;
        }, true);
        img.src = imgIdents[key];
        img.gamejsKey = key;
      }
      if (TOTAL_IMGS > 0) {
        _PRELOADING = true;
      }
      return;
    };

    /**
     * @ignore
     */
    exports.isPreloading = function() {
      return _PRELOADING;
    }

    /**
     * add the given <img> dom elements into the cache.
     * @private
     */
    var addToCache = function(img) {
      CACHE[img.gamejsKey] = img;
      return;
    };

  },
  'gamejs/mask': function(require, exports, module) {
    var gamejs = require('gamejs');
    var objects = require('gamejs/utils/objects');

    /**
     * @fileoverview Image masks. Usefull for pixel perfect collision detection.
     */

    /**
     * Creates an image mask from the given Surface. The alpha of each pixel is checked
     * to see if it is greater than the given threshold. If it is greater then
     * that pixel is set as non-colliding.
     *
     * @param {gamejs.Surface} surface
     * @param {Number} threshold 0 to 255. defaults to: 255, fully transparent
     */
    exports.fromSurface = function(surface, threshold) {
      var threshold = threshold && (255 - threshold) || 255;
      var imgData = surface.getImageData();
      var dims = surface.getSize()
        var mask = new Mask(dims);
      for (var i=0;i<imgData.length;i += 4) {
        // y: pixel # / width
        var y = parseInt((i / 4) / dims[0], 10);
        // x: pixel # % width
        var x = parseInt((i / 4) % dims[0], 10);
        var alpha = imgData[i+3];
        if (alpha >= threshold) {
          mask.setAt(x, y);
        }
      };
      return mask;
    };

    /**
     * Image Mask
     * @param {Array} dimensions [width, height]
     *
     */
    var Mask = exports.Mask = function(dims) {
      this.width = dims[0];
      this.height = dims[1];
      this._bits = [];
      for (var i=0;i<this.width;i++) {
        this._bits[i] = [];
        for (var j=0;j<this.height;j++) {
          this._bits[i][j] = false;
        }
      };
      return;
    };

    /**
     * @returns the overlapping rectangle or null if there is no overlap;
     */
    Mask.prototype.overlapRect = function(otherMask, offset) {
      var arect = this.rect;
      var brect = otherMask.rect;
      if (offset) {
        brect.moveIp(offset);
      }
      // bounding box intersect
      if (!brect.collideRect(arect)) {
        return null;
      };
      var xStart = Math.max(arect.left, brect.left);
      var xEnd = Math.min(arect.right, brect.right);

      var yStart = Math.max(arect.top, brect.top);
      var yEnd = Math.min(arect.bottom, brect.bottom);

      return new gamejs.Rect([xStart, yStart], [xEnd - xStart, yEnd - yStart]);
    };

    /**
     *
     * @returns True if the otherMask overlaps with this map.
     * @param {Mask} otherMask
     * @param {Array} offset
     */
    Mask.prototype.overlap = function(otherMask, offset) {
      var overlapRect = this.overlapRect(otherMask, offset);
      if (overlapRect === null) {
        return false;
      }

      var arect = this.rect;
      var brect = otherMask.rect;
      if (offset) {
        brect.moveIp(offset);
      }

      var count = 0;
      for (var y=overlapRect.top; y<=overlapRect.bottom; y++) {
        for (var x=overlapRect.left; x<=overlapRect.right; x++) {
          if (this.getAt(x - arect.left, y - arect.top) &&
              otherMask.getAt(x - brect.left, y - brect.top)) {
            return true;
          }
        };
      };
      // NOTE this should not happen
      return false;
    };

    /**
     * @returns the number of overlapping pixels
     */
    Mask.prototype.overlapArea = function(otherMask, offset) {
      var overlapRect = this.overlapRect(otherMask, offset);
      if (overlapRect === null) {
        return 0;
      }

      var arect = this.rect;
      var brect = otherMask.rect;
      if (offset) {
        brect.moveIp(offset);
      }

      var count = 0;
      for (var y=overlapRect.top; y<=overlapRect.bottom; y++) {
        for (var x=overlapRect.left; x<=overlapRect.right; x++) {
          if (this.getAt(x - arect.left, y - arect.top) &&
              otherMask.getAt(x - brect.left, y - brect.top)) {
            count++;
          }
        };
      };
      return count;
    };

    /**
     * @returns a mask of the overlapping pixels
     */
    Mask.prototype.overlapMask = function(otherMask, offset) {
      var overlapRect = this.overlapRect(otherMask, offset);
      if (overlapRect === null) {
        return 0;
      }

      var arect = this.rect;
      var brect = otherMask.rect;
      if (offset) {
        brect.moveIp(offset);
      }

      var mask = new Mask([overlapRect.width, overlapRect.height]);
      for (var y=overlapRect.top; y<=overlapRect.bottom; y++) {
        for (var x=overlapRect.left; x<=overlapRect.right; x++) {
          if (this.getAt(x - arect.left, y - arect.top) &&
              otherMask.getAt(x - brect.left, y - brect.top)) {
            mask.setAt(x, y);
          }
        };
      };
      return mask;
    };

    /**
     * Set bit at position.
     * @param {Number} x
     * @param {Number} y
     */
    Mask.prototype.setAt = function(x, y) {
      this._bits[x][y] = true;
    };

    /**
     * Get bit at position.
     *
     * @param {Number} x
     * @param {Number} y
     */
    Mask.prototype.getAt = function(x, y) {
      x = parseInt(x, 10);
      y = parseInt(y, 10);
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;

      return this._bits[x][y];
    };


    /**
     * Flip the bits in this map.
     */
    Mask.prototype.invert = function() {
      this._bits = this._bits.map(function(row) {
        return row.map(function(b) {
          return !b;
        });
      });
    };

    /**
     * @returns {Array} the dimensions of the map
     */
    Mask.prototype.getSize = function() {
      return [this.width, this.height];
    };

    objects.accessors(Mask.prototype, {
      /**
       * Rect of this Mask.
       */
      'rect': {
        get: function() {
               return new gamejs.Rect([0, 0], [this.width, this.height]);
             }
      },
      /**
       * @returns {Number} number of set pixels in this mask.
       */
      'length': {
        get: function() {
               var c = 0;
               this._bits.forEach(function(row) {
                 row.forEach(function(b) {
                   if (b) c++;
                 });
               });
               return c;
             }
      }
    });

  },
  'gamejs/mixer': function(require, exports, module) {
    var gamejs = require('gamejs');

    /**
     * @fileoverview Playing sounds with the html5 audio tag. Audio files must be preloaded
     * with the usual `gamejs.preload()` function. Ogg, wav and webm supported.
     */

    var CACHE = {};

    /**
     * need to export preloading status for require
     * @ignore
     */
    var _PRELOADING = false

      /**
       * put all audios on page in cache
       * if same domain as current page, remove common href-prefix
       * @ignore
       */
      exports.init = function() {
        var audios = Array.prototype.slice.call(document.getElementsByTagName("audio"), 0);
        addToCache(audios);
        return;
      };

    /**
     * Preload the audios into cache
     * @param {String[]} List of audio URIs to load
     * @ignore
     */
    exports.preload = function(audioUrls, showProgressOrImage) {
      var TOTAL_SOUNDS = 0;
      var countLoaded = 0;

      var incrementLoaded = function() {
        countLoaded++;
        if (countLoaded == TOTAL_SOUNDS) {
          _PRELOADING = false;
        }
      };

      for (var key in audioUrls) {
        if (key.indexOf('wav') == -1 && key.indexOf('ogg') == -1 && key.indexOf('webm') == -1) {
          continue;
        }
        TOTAL_SOUNDS++;
        var audio = new Audio();
        audio.addEventListener('canplay', function() {
          addToCache(this);
          incrementLoaded();
          return;
        }, true);
        audio.addEventListener('error', function() {
          incrementLoaded();
          throw new Error('Error loading ' + this.src);
          return;
        }, true);
        audio.src = audioUrls[key];
        audio.gamejsKey = key;
        audio.load();
      }
      if (TOTAL_SOUNDS > 0) {
        _PRELOADING = true;
      }
      return;
    };

    /**
     * @ignore
     */
    exports.isPreloading = function() {
      return _PRELOADING;
    }

    /**
     * @param {dom.ImgElement} audios the <audio> elements to put into cache
     * @ignore
     */
    var addToCache = function(audios) {
      if (!(audios instanceof Array)) audios = [audios];

      var docLoc = document.location.href;
      audios.forEach(function(audio) {
        CACHE[audio.gamejsKey] = audio;
      });
      return;
    };

    /**
     * Sounds can be played back.
     * @constructor
     * @param {String|dom.AudioElement} uriOrAudio the uri of <audio> dom element
     *                of the sound
     */
    exports.Sound = function Sound(uriOrAudio) {
      var cachedAudio;
      if (typeof uriOrAudio === 'string') {
        cachedAudio = CACHE[uriOrAudio];
      } else {
        cachedAudio = uriOrAudio;
      }
      if (!cachedAudio) {
        // TODO sync audio loading
        throw new Error('Missing "' + uriOrAudio + '", gamejs.preload() all audio files before loading');
      }

      var audio = new Audio();
      audio.preload = "auto";
      audio.loop = "false";
      audio.src = cachedAudio.src;
      /**
       * start the sound
       */
      this.play = function() {
        //console.debug("inside audio play function");
        if (audio.ended || audio.paused) {
          audio.play();
          console.debug(audio.loop);
          console.debug("play jump sound");
        }
      }

      /**
       * Stop the sound
       */
      this.stop = function() {
        audio.pause();
      }

      /**
       * Set volume of this sound
       * @param {Number} value volume from 0 to 1
       */
      this.setVolume = function(value) {
        audio.volume = value;
      }

      /**
       * @returns {Number} the sound's volume from 0 to 1
       */
      this.getVolume = function() {
        return audio.volume;
      }

      /**
       * @returns {Number} Duration of this sound in seconds
       */
      this.getLength = function() {
        return audio.duration;
      };

      return this;
    };

  },
  'gamejs/sprite': function(require, exports, module) {
    var gamejs = require('gamejs');
    var sprite = require('gamejs/sprite');
    var arrays = require('gamejs/utils/arrays');

    /**
     * @fileoverview Provides `Sprite` the basic building block for any game and
     * `SpriteGroups`, which are an efficient
     * way for doing collision detection between groups as well as drawing layered
     * groups of objects on the screen.
     *
     */

    /**
     * Your visible game objects will typically subclass Sprite. By setting it's image
     * and rect attributes you can control its appeareance. Those attributes control
     * where and what `Sprite.draw(surface)` will blit on the the surface.
     *
     * Your subclass should overwrite `update(msDuration)` with its own implementation.
     * This function is called once every game tick, it is typically used to update
     * the status of that object.
     * @constructor
     */
    var Sprite = exports.Sprite = function() {
      /** @ignore */
      this._groups = [];
      /** @ignore */
      this._alive = true;

      /**
       * Image to be rendered for this Sprite.
       * @type gamejs.Surface
       */
      this.image = null;
      /**
       * Rect describing the position of this sprite on the display.
       * @type gamejs.Rect
       */
      this.rect = null;

      return this;
    };

    /**
     * Kill this sprite. This removes the sprite from all associated groups and 
     * makes future calls to `Sprite.isDead()` return `false`
     */
    Sprite.prototype.kill = function() {
      this._alive = false;
      this._groups.forEach(function(group) {
        group.remove(this);
      }, this);
      return;
    };

    /**
     * Remove the sprite from the passed groups
     * @param {Array|gamejs.sprite.Group} groups One or more `gamejs.Group`
     * instances
     */
    Sprite.prototype.remove = function(groups) {
      if (!(groups instanceof Array)) groups = [groups];

      groups.forEach(function(group) {
        group.remove(this);
      }, this);
      return;
    };

    /**
     * Add the sprite to the passed groups
     * @param {Array|gamejs.sprite.Group} groups One or more `gamejs.sprite.Group`
     * instances
     */
    Sprite.prototype.add = function(groups) {
      if (!(groups instanceof Array)) groups = [groups];

      groups.forEach(function(group) {
        group.add(this);
      }, this);
      return;
    };

    /**
     * Draw this sprite onto the given surface. The position is defined by this
     * sprite's rect.
     * @param {gamejs.Surface} surface The surface to draw on
     */
    Sprite.prototype.draw = function(surface) {
      surface.blit(this.image, this.rect);
      return;
    };

    /**
     * Update this sprite. You **should** override this method with your own to
     * update the position, status, etc.
     */
    Sprite.prototype.update = function() {};

    /**
     * @returns {Boolean} True if this sprite has had `Sprite.kill()` called on it
     * previously, otherwise false
     */
    Sprite.prototype.isDead = function() {
      return !this._alive;
    };

    /**
     * Sprites are often grouped. That makes collision detection more efficient and
     * improves rendering performance. It also allows you to easly keep track of layers
     * of objects which are rendered to the screen in a particular order.
     *
     * `Group.update()` calls `update()` on all the contained sprites; the same is true for `draw()`.
     * @constructor
     */
    var Group = exports.Group = function() {
      /** @ignore */
      this._sprites = [];


      if (arguments[0] instanceof Sprite ||
          (arguments[0] instanceof Array &&
           arguments[0].length &&
           arguments[0][0] instanceof Sprite
          )) {
        this.add(arguments[0]);
      }
      return this;
    };

    /**
     * Update all the sprites in this group. This is equivalent to calling the
     * update method on each sprite in this group.
     */
    Group.prototype.update = function() {
      var updateArgs = arguments;

      this._sprites.forEach(function(sp) {
        sp.update.apply(sp, updateArgs);
      }, this);
      return;
    };

    /**
     * Add one or more sprites to this group
     * @param {Array|gamejs.sprite.Sprite} sprites One or more
     * `gamejs.sprite.Sprite` instances
     */
    Group.prototype.add = function(sprites) {
      if (!(sprites instanceof Array)) sprites = [sprites];

      sprites.forEach(function(sprite) {
        this._sprites.push(sprite);
        sprite._groups.push(this);
      }, this);
      return;
    };

    /**
     * Remove one or more sprites from this group
     * @param {Array|gamejs.sprite.Sprite} sprites One or more
     * `gamejs.sprite.Sprite` instances
     */
    Group.prototype.remove = function(sprites) {
      if (!(sprites instanceof Array)) sprites = [sprites];

      sprites.forEach(function(sp) {
        arrays.remove(sp, this._sprites);
        arrays.remove(this, sp._groups);
      }, this);
      return;
    };

    /**
     * Check for the existence of one or more sprites within a group
     * @param {Array|gamejs.sprite.Sprite} sprites One or more
     * `gamejs.sprite.Sprite` instances
     * @returns {Boolean} True if every sprite is in this group, false otherwise
     */
    Group.prototype.has = function(sprites) {
      if (!(sprites instanceof Array)) sprites = [sprites];

      return sprites.every(function(sp) {
        return this._sprites.indexOf(sp) !== -1;
      }, this);
    };

    /**
     * Get the sprites in this group
     * @returns {Array} An array of `gamejs.sprite.Sprite` instances
     */
    Group.prototype.sprites = function() {
      return this._sprites;
    }

    /**
     * Draw all the sprites in this group. This is equivalent to calling each
     * sprite's draw method.
     */
    Group.prototype.draw = function() {
      var args = arguments;
      this._sprites.forEach(function(sprite) {
        sprite.draw.apply(sprite, args);
      }, this);
      return;
    };

    /**
     * Remove all sprites from this group
     */
    Group.prototype.empty = function() {
      this._sprites = [];
      return;
    };

    /**
     * @returns {Array} of sprites colliding with the point
     */
    Group.prototype.collidePoint = function() {
      var args = Array.prototype.slice.apply(arguments);
      return this._sprites.filter(function(sprite) {
        return sprite.rect.collidePoint.apply(sprite.rect, args);
      }, this);
    }

    /**
     * Loop over each sprite in this group. This is a shortcut for
     * `group.sprites().forEach(...)`.
     */
    Group.prototype.forEach = function() {
      Array.prototype.forEach.apply(this._sprites, arguments);
    };

    /**
     * Check whether some sprite in this group passes a test. This is a shortcut
     * for `group.sprites().some(...)`.
     */
    Group.prototype.some = function() {
      return Array.prototype.some.apply(this._sprites, arguments);
    };

    /**
     * Find sprites in a group that intersect another sprite
     * @param {gamejs.sprite.Sprite} sprite The sprite to check
     * @param {gamejs.sprite.Group} group The group to check
     * @param {Boolean} doKill If true, kill sprites in the group when collided
     * @param {function} collided Collision function to use, defaults to `gamejs.sprite.collideRect`
     * @returns {Array} An array of `gamejs.sprite.Sprite` instances that collided
     */
    exports.spriteCollide = function(sprite, group, doKill, collided) {
      var collided = collided || collideRect;
      var doKill = doKill || false;

      var collidingSprites = [];
      group.sprites().forEach(function(groupSprite) {
        if (collided(sprite, groupSprite)) {
          if (doKill) groupSprite.kill();

          collidingSprites.push(groupSprite);
        }
      });
      return collidingSprites;
    };

    /**
     * Find all Sprites that collide between two Groups.
     *
     * @example
     * groupCollide(group1, group2).forEach(function (collision) {
     *    var group1Sprite = collision.a;
     *    var group2Sprite = collision.b;
     *    // Do processing here!
     * });
     *
     * @param {gamejs.sprite.Group} groupA First group to check
     * @param {gamejs.sprite.Group} groupB Second group to check
     * @param {Boolean} doKillA If true, kill sprites in the first group when
     * collided
     * @param {Boolean} doKillB If true, kill sprites in the second group when
     * collided
     * @returns {Array} A list of objects where properties 'a' and 'b' that 
     * correspond with objects from the first and second groups
     */
    exports.groupCollide = function(groupA, groupB, doKillA, doKillB) {
      var doKillA = doKillA || false;
      var doKillB = doKillB || false;

      var collideList = [];

      groupA.sprites().forEach(function(groupSpriteA) {
        groupB.sprites().forEach(function(groupSpriteB) {
          if (collideRect(groupSpriteA, groupSpriteB)) {
            if (doKillA) groupSpriteA.kill();
            if (doKillB) groupSpriteB.kill();

            collideList.push({
              'a': groupSpriteA,
              'b': groupSpriteB
            });
          }
        });
      });

      return collideList;
    };

    /**
     * Check for collisions between two sprites using their rects.
     *
     * @param {gamejs.sprite.Sprite} spriteA First sprite to check
     * @param {gamejs.sprite.Sprite} spriteB Second sprite to check
     * @returns {Boolean} True if they collide, false otherwise
     */
    var collideRect = exports.collideRect = function(spriteA, spriteB) {
      return spriteA.rect.collideRect(spriteB.rect);
    };

    /**
     * Collision detection between two sprites utilizing the optional `mask` 
     * attribute on the sprites. Beware: expensive operation.
     *
     * @param {gamejs.sprite.Sprite} spriteA Sprite with 'mask' property set to a `gamejs.mask.Mask`
     * @param {gamejs.sprite.Sprite} spriteB Sprite with 'mask' property set to a `gamejs.mask.Mask`
     * @returns {Boolean} True if any mask pixels collide, false otherwise
     */
    exports.collideMask = function(spriteA, spriteB) {
      if (!spriteA.mask || !spriteB.mask) {
        throw new Error("Both sprites must have 'mask' attribute set to an gamejs.mask.Mask");
      }
      var offset = [
        spriteB.rect.left - spriteA.rect.left,
        spriteB.rect.top - spriteA.rect.top
          ];
      return spriteA.mask.overlap(spriteB.mask, offset);
    };

  },
  'gamejs/utils/arrays': function(require, exports, module) {
    /**
     * @fileoverview Utility functions for working with Objects
     */

    exports.remove = function(item, array) {
      return array.splice(array.indexOf(item), 1);
    };

  },
  'gamejs/surfacearray': function(require, exports, module) {
    var gamejs = require('gamejs');
    var accessors = require('gamejs/utils/objects').accessors;
    /**
     * @fileoverview Fast pixel access.
     *
     * @example
     *   // create array from display surface
     *   var srfArray = new SurfaceArray(display);
     *   // direct pixel access
     *   srfArray.set(50, 100, [255, 0, 0, 100]);
     *   console.log(srfArray.get(30, 50));
     *   // blit modified array back to display surface
     *   blitArray(display, srfArray);
     */

    /**
     *
     * Directly copy values from an array into a Surface.
     *
     * This is faster than using SurfaceArray.image to convert into a Surface
     * and then blitting.
     *
     * The array must be the same dimensions as the Surface and will completely
     * replace all pixel values.
     */
    exports.blitArray = function(surface, surfaceArray) {
      surface.context.putImageData(surfaceArray.imageData, 0, 0);
      return;
    }

    /**
     * The SurfaceArray can be constructed with a surface whose values
     * are then used to initialize the pixel array.
     *
     * The surface passed as argument is not modified by the SurfaceArray.
     *
     * If an array is used to construct SurfaceArray, the array must describe
     * the dimensions of the SurfaceArray [width, height].
     *
     * @param {gamejs.Surface|Array} surfaceOrDimensions
     * @see http://dev.w3.org/html5/2dcontext/#pixel-manipulation
     */
    var SurfaceArray = exports.SurfaceArray = function(surfaceOrDimensions) {

      /*
       * Set rgba value at position x, y.
       *
       * For performance reasons this function has only one signature
       * being Number, Number, Array[4].
       *
       * @param {Number} x x position of pixel
       * @param {Number} y y position of pixel
       * @param {Array} rgba [red, green, blue, alpha] values [255, 255, 255, 1] (alpha, last argument: defaults to 0)
       * @throws Error if x, y out of range
       */
      this.set = function(x, y, rgba) {
        var offset = (x * 4) + (y * size[0] * 4);
        /** faster without
          if (offset + 3 >= data.length || x < 0 || y < 0) {
          throw new Error('x, y out of range', x, y);
          }
         **/
        data[offset] = rgba[0];
        data[offset+1] = rgba[1];
        data[offset+2] = rgba[2];
        data[offset+3] = rgba[3] ||  255;
        return;
      };

      /**
       * Get rgba value at position xy,
       * @param {Number} x
       * @param {Number} y
       * @returns {Array} [red, green, blue, alpha]
       */
      this.get = function(x, y) {
        var offset = (x * 4) + (y * size[0] * 4);
        return [
          data[offset],
          data[offset+1],
          data[offset+2],
          data[offset+3]
            ]
      };

      /**
       * a new gamejs.Surface on every access, representing
       * the current state of the SurfaceArray.
       * @type {gamejs.Surface}
       */
      // for jsdoc only
      this.surface = null;

      accessors(this, {
        surface: {
                   get: function() {
                          var s = new gamejs.Surface(size);
                          s.context.putImageData(imageData, 0, 0);
                          return s;
                        }
                 },
        imageData: {
                     get: function() {
                            return imageData;
                          }
                   }
      });

      /**
       * constructor
       */
      var size = null;
      var data = null;
      var imageData = null;
      if (surfaceOrDimensions instanceof Array) {
        size = surfaceOrDimensions;
        imageData = gamejs.display.getSurface().context.createImageData(size[0], size[1]);
      } else {
        size = surfaceOrDimensions.getSize();
        imageData = surfaceOrDimensions.getImageData(0, 0, size[0], size[1]);
      }
      data = imageData.data;
      return this;
    };

  },
  'gamejs/time': function(require, exports, module) {
    /**
     * @fileoverview
     * Provides tools for game time managment.
     *
     * This is very different from how PyGame works. We can not
     * pause the execution of the script in Browser JavaScript, so what
     * we do you do is write a main function which contains the code
     * you would put into your main loop and pass that to `fpsCallback()`:
     *
     * @example
     * function main() {
     *     // update models
     *     // draw to screen
     *  };
     *  gamejs.time.fpsCallback(main, this, 30);
     *
     */


    var TIMER_LASTCALL = null;
    var CALLBACKS = {};
    var CALLBACKS_LASTCALL = {};
    var TIMER = null;
    var STARTTIME = null;

    /**
     * @ignore
     */
    exports.init = function() {
      STARTTIME = Date.now();
      TIMER = setInterval(perInterval, 10);
      return;
    };

    /**
     * @param {Function} fn the function to call back
     * @param {Object} thisObj `this` will be set to that object when executing the function
     * @param {Number} fps specify the framerate by which you want the callback to be called. (e.g. 30 = 30 times per seconds). default: 30
     */
    exports.fpsCallback = function(fn, thisObj, fps) {
      fps = parseInt(1000/fps, 10);
      if (CALLBACKS[fps] === undefined) CALLBACKS[fps] = [];
      if (CALLBACKS_LASTCALL[fps] === undefined) CALLBACKS_LASTCALL[fps] = 0;

      CALLBACKS[fps].push({
        'rawFn': fn,
        'callback': function(msWaited) {
          fn.apply(thisObj, [msWaited]);
        },
      });
      return;
    };

    /**
     * @param {Function} callback the function delete
     * @param {Number} fps
     */
    exports.deleteCallback = function(callback, fps) {
      fps = parseInt(1000/fps, 10)
        var callbacks = CALLBACKS[fps];
      if (!callbacks) return;

      CALLBACKS[fps] = callbacks.filter(function(fnInfo, idx) {
        if (fnInfo.rawFn !== callback) return true;
        return false;
      });
      return;
    };

    var perInterval = function() {
      var msNow = Date.now();
      var lastCalls = CALLBACKS_LASTCALL;
      for (var fpsKey in lastCalls) {
        if (!lastCalls[fpsKey]) {
          CALLBACKS_LASTCALL[fpsKey] = msNow;
        }
        var msWaited = msNow - lastCalls[fpsKey];
        if (fpsKey <= msWaited) {
          CALLBACKS_LASTCALL[fpsKey] = msNow;
          CALLBACKS[fpsKey].forEach(function(fnInfo) {
            fnInfo.callback(msWaited);
          }, this);
        }
      }
      return;
    };

  },
  'gamejs/transform': function(require, exports, module) {
    var Surface = require('gamejs').Surface;
    var matrix = require('gamejs/utils/matrix');

    /**
     * @fileoverview Rotate and scale Surfaces.
     */

    /**
     * Returns a new surface which holds the original surface rotate by angle degrees.
     * @param {Surface} surface
     * @param {angel} angle Clockwise angle by which to rotate
     * @returns {Surface} new, rotated surface
     */
    exports.rotate = function (surface, angle) {
      // degrees
      // FIXME the size of the new surface should be increased if the rotation requires taht
      var origSize = surface.getSize();
      var newSurface = new Surface(origSize);
      var oldMatrix = surface._matrix;
      surface._matrix = matrix.translate(surface._matrix, origSize[0]/2, origSize[1]/2);
      surface._matrix = matrix.rotate(surface._matrix, (angle * Math.PI / 180));
      surface._matrix = matrix.translate(surface._matrix, -origSize[0]/2, -origSize[1]/2);
      newSurface.blit(surface);
      surface._matrix = oldMatrix;
      return newSurface;
    };

    /**
     * Returns a new surface holding the scaled surface.
     * @param {Surface} surface
     * @param {Array} scale new [widthScale, heightScale] in range; e.g.: [2,2] would double the size
     * @returns {Surface} new, scaled surface
     */
    exports.scale = function(surface, dims) {
      var width = dims[0];
      var height = dims[1];
      var newDims = surface.getSize();
      newDims = [newDims[0] * dims[0], newDims[1] * dims[1]];
      var newSurface = new Surface(newDims);
      newSurface._matrix = matrix.scale(newSurface._matrix, [width, height]);
      newSurface.blit(surface);
      return newSurface;
    };

    /**
     * Flip a Surface either vertically, horizontally or both. This returns
     * a new Surface (i.e: nondestructive).
     */
    exports.flip = function(surface, flipHorizontal, flipVertical) {
      var dims = surface.getSize();
      var newSurface = new Surface(dims);
      var scaleX = 1;
      var scaleY = 1;
      var xPos = 0;
      var yPos = 0;
      if (flipHorizontal === true) {
        scaleX = -1;
        xPos = -dims[0];
      }
      if (flipVertical === true) {
        scaleY = -1;
        yPos = -dims[1];
      }
      newSurface.context.save();
      newSurface.context.scale(scaleX, scaleY);
      newSurface.context.drawImage(surface.canvas, xPos, yPos);
      newSurface.context.restore();
      return newSurface;
    };

  },
  'gamejs/pathfinding/astar': function(require, exports, module) {
    /**
     * @fileoverview
     * AStar Path finding algorithm
     *
     * Use the `findRoute(map, from, to, [timeout])` function to get the linked list
     * leading `from` a point `to` another on the given `map`.
     *
     * The map must implement interface `gamejs.pathfinding.Map` (this
     * class really holds an example implementation & data for you to study).
     *
     * The resulting point list includes the two points `from` and `to` and in
     * between all points leading from `to` to `from` (yes, in reverted order.
     * It is quicker that way. If you need them the other way around: revert yourself).
     *
     * Example result
     *
     *     ({
     *         point: [
     *             3,
     *             3
     *         ],
     *         from: {
     *             point: [
     *                 2,
     *                 2
     *             ],
     *             from: {
     *                <<< cut for clarity >>>
     *             },
     *             length: 524,
     *             score: 665
     *         },
     *         length: 729,
     *         score: 729
     *     })
     *
     * Optionally, the search is canceld after `timeout` in millseconds.
     *
     * If there is no route `null` is returned.
     *
     * Points are given as an Array [x, y].
     *
     * @see http://eloquentjavascript.net/chapter7.html
     */
    var BinaryHeap = require('gamejs/utils/binaryheap').BinaryHeap;

    /**
     * helper function for A*
     */
    function ReachedList() {
      var list = {};

      this.store = function(point, route) {
        list[hash(point)] = route;
        return;
      };

      this.find = function(point) {
        return list[hash(point)];
      };
      return this;
    };


    /** A* search function.
     *
     * This function expects a `Map` implementation and the origin and destination
     * points given as [x,y] arrays. If there is a path between the two it will return the optimal
     * path as a linked list. If there is no path it will return null.
     *
     * The linked list is in reverse order: the first item is the destination and
     * the path to the origin follows.
     *
     * @param {Map} map map instance, must follow interface defined in {Map}
     * @param {Array} origin
     * @param {Array} destination
     * @param {Number} timeout milliseconds after which search should be canceled
     * @returns {Object} the linked list leading from `to` to `from` (sic!).
     **/
    exports.findRoute = function(map, from, to, timeout) {
      var open = new BinaryHeap(routeScore);
      var reached = new ReachedList();

      function routeScore(route) {
        if (route.score == undefined) {
          route.score = map.estimatedDistance(route.point, to) + route.length;
        }
        return route.score;
      }
      function addOpenRoute(route) {
        open.push(route);
        reached.store(route.point, route);
      }
      addOpenRoute({point: from,
        from: null,
        length: 0});

      var startMs = Date.now();
      while (open.size() > 0 && (!timeout || Date.now() - startMs < timeout)) {
        var route = open.pop();
        if (equals(to, route.point)) {
          return route;
        }
        map.adjacent(route.point).forEach(function(direction) {
          var known = reached.find(direction);
          var newLength = route.length +
          map.actualDistance(route.point, direction);
        if (!known || known.length > newLength){
          if (known) {
            open.remove(known);
          }
          addOpenRoute({point: direction,
            from: route,
            length: newLength});
        }
        });
      } // end while
      return null;
    };

    /**
     * Unique hash for the point
     * @param {Array} p point
     * @returns {String}
     */
    function hash(p) {
      return p[0] + "-" + p[1];
    };

    /**
     * Are two points equal?
     * @param {Array} a point
     * @param {Array} b point
     * @returns {Boolean}
     */
    function equals(a, b) {
      return a[0] === b[0] && a[1] === b[1];
    };

    /**
     * This is the interface for a Map that can be passed to the `findRoute()`
     * function. `Map` is not instantiable - see the unit tests for an example
     * implementation of Map.
     */
    var Map = exports.Map = function() {
      throw new Error('not instantiable, this is an interface');
    };

    /**
     * @param {Array} origin
     * @returns {Array} list of `Point`s accessible from given Point
     */
    Map.prototype.adjacent = function(origin) {
    };

    /**
     * Estimated lower bound distance between two given points.
     * @param {Array} pointA
     * @param {Array} pointB
     * @returns {Number} the estimated distance between two points
     */
    Map.prototype.estimatedDistance = function(pointA, pointB) {
    };

    /**
     * Actual distance between the two given points.
     * @param {Array} pointA
     * @param {Array} pointB
     * @returns {Number} the actual distance between two points
     */
    Map.prototype.actualDistance = function(pointA, pointB) {
    }

  },
  'gamejs/utils/binaryheap': function(require, exports, module) {
    /**
     * Binary Heap
     *
     * @see http://eloquentjavascript.net/appendix2.html
     */
    var BinaryHeap = exports.BinaryHeap = function(scoreFunction){
      this.content = [];
      this.scoreFunction = scoreFunction;
      return this;
    }

    /**
     * Add element to heap.
     * @param {Object} element
     */
    BinaryHeap.prototype.push = function(element) {
      this.content.push(element);
      this.sinkDown(this.content.length - 1);
      return;
    };

    /**
     * Return first element from heap.
     * @param {Object} element
     * @returns {Object} element
     */
    BinaryHeap.prototype.pop = function() {
      // Store the first element so we can return it later.
      var result = this.content[0];
      // Get the element at the end of the array.
      var end = this.content.pop();
      // If there are any elements left, put the end element at the
      // start, and let it bubble up.
      if (this.content.length > 0) {
        this.content[0] = end;
        this.bubbleUp(0);
      }
      return result;
    };

    /**
     * Remove the given element from the heap.
     * @param {Object} element
     * @throws {Error} if node not found
     */
    BinaryHeap.prototype.remove = function(node) {
      // To remove a value, we must search through the array to find
      // it.
      var isFound = this.content.some(function(cNode, idx) {
        if (cNode == node) {
          var end = this.content.pop();
          if (idx != this.content.length) {
            this.content[idx] = end;
            if (this.scoreFunction(end) < this.scoreFunction(node)) {
              this.sinkDown(idx);
            } else {
              this.bubbleUp(idx);
            }
          }
          return true;
        }
        return false;
      }, this);
      if (!isFound) throw new Error("Node not found.");
      return;
    };

    /**
     * Number of elements in heap.
     */
    BinaryHeap.prototype.size = function() {
      return this.content.length;
    };

    /**
     * @ignore
     */
    BinaryHeap.prototype.sinkDown = function(idx) {
      // Fetch the element that has to be sunk
      var element = this.content[idx];
      // When at 0, an element can not sink any further.
      while (idx > 0) {
        // Compute the parent element's index, and fetch it.
        var parentIdx = Math.floor((idx + 1) / 2) - 1;
        var parent = this.content[parentIdx];
        // Swap the elements if the parent is greater.
        if (this.scoreFunction(element) < this.scoreFunction(parent)) {
          this.content[parentIdx] = element;
          this.content[idx] = parent;
          // Update 'n' to continue at the new position.
          idx = parentIdx;
          // Found a parent that is less, no need to sink any further.
        } else {
          break;
        }
      }
      return;
    };

    /**
     * @ignore
     */
    BinaryHeap.prototype.bubbleUp = function(idx) {
      // Look up the target element and its score.
      var length = this.content.length;
      var element = this.content[idx];
      var elemScore = this.scoreFunction(element);

      while(true) {
        // Compute the indices of the child elements.
        var child2Idx = (idx + 1) * 2;
        var child1Idx= child2Idx - 1;
        // This is used to store the new position of the element,
        // if any.
        var swapIdx = null;
        // If the first child exists (is inside the array)...
        if (child1Idx < length) {
          // Look it up and compute its score.
          var child1 = this.content[child1Idx];
          var child1Score = this.scoreFunction(child1);
          // If the score is less than our element's, we need to swap.
          if (child1Score < elemScore) {
            swapIdx = child1Idx;
          }
        }
        // Do the same checks for the other child.
        if (child2Idx < length) {
          var child2 = this.content[child2Idx];
          var child2Score = this.scoreFunction(child2);
          if (child2Score < (swapIdx == null ? elemScore : child1Score)) {
            swapIdx = child2Idx;
          }
        }

        // If the element needs to be moved, swap it, and continue.
        if (swapIdx != null) {
          this.content[idx] = this.content[swapIdx];
          this.content[swapIdx] = element;
          idx = swapIdx;
          // Otherwise, we are done.
        } else {
          break;
        }
      }
      return;
    };

  },
  });
require.ensure(["gamejs","gamejs/utils/matrix","gamejs/utils/objects","gamejs/display","gamejs/draw","gamejs/event","gamejs/font","gamejs/http","gamejs/image","gamejs/mask","gamejs/mixer","gamejs/sprite","gamejs/utils/arrays","gamejs/surfacearray","gamejs/time","gamejs/transform","gamejs/pathfinding/astar","gamejs/utils/binaryheap"], function() {
  require('gamejs');
});
})(modulr.require, modulr.require.main);
