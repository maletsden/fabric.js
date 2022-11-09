//@ts-nocheck

import { config } from '../config';
import { createImageData } from 'canvas';
const headless_gl = require('gl');

(function (global) {
  var fabric = global.fabric;

  fabric.WebglHeadlessFilterBackend = WebglHeadlessFilterBackend;

  /**
   * WebGL filter backend.
   */
  function WebglHeadlessFilterBackend(options) {
    if (options && options.tileSize) {
      this.tileSize = options.tileSize;
    }
    this.setupGLContext(this.tileSize, this.tileSize);
    this.captureGPUInfo();
  }

  WebglHeadlessFilterBackend.prototype =
    /** @lends fabric.WebglHeadlessFilterBackend.prototype */ {
      tileSize: config.textureSize,

      /**
       * Experimental. This object is a sort of repository of help layers used to avoid
       * of recreating them during frequent filtering. If you are previewing a filter with
       * a slider you probably do not want to create help layers every filter step.
       * in this object there will be appended some canvases, created once, resized sometimes
       * cleared never. Clearing is left to the developer.
       **/
      resources: {},

      /**
       * Setup a WebGL context suitable for filtering, and bind any needed event handlers.
       */
      setupGLContext: function (width, height) {
        this.dispose();
        this.createWebGLCanvas(width, height);
        // eslint-disable-next-line
        this.aPosition = new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]);
        this.imageBuffer = new ArrayBuffer(width * height * 4);
        this._conversionCanvasEl = fabric.util.createCanvasElement();
      },

      /**
       * Create a canvas element and associated WebGL context and attaches them as
       * class properties to the GLFilterBackend class.
       */
      createWebGLCanvas: function (width, height) {
        var canvas = fabric.util.createCanvasElement();
        canvas.width = width;
        canvas.height = height;
        var glOptions = {
            alpha: true,
            premultipliedAlpha: false,
            depth: false,
            stencil: false,
            antialias: false,
          },
          gl = headless_gl(width, height, glOptions);

        if (!gl) {
          return;
        }
        gl.clearColor(0, 0, 0, 0);
        // this canvas can fire webglcontextlost and webglcontextrestored
        this.canvas = canvas;
        this.gl = gl;
      },

      /**
       * Attempts to apply the requested filters to the source provided, drawing the filtered output
       * to the provided target canvas.
       *
       * @param {Array} filters The filters to apply.
       * @param {HTMLImageElement|HTMLCanvasElement} source The source to be filtered.
       * @param {Number} width The width of the source input.
       * @param {Number} height The height of the source input.
       * @param {HTMLCanvasElement} targetCanvas The destination for filtered output to be drawn.
       * @param {String|undefined} cacheKey A key used to cache resources related to the source. If
       * omitted, caching will be skipped.
       */
      applyFilters: function (
        filters,
        source,
        width,
        height,
        targetCanvas,
        cacheKey
      ) {
        var gl = this.gl;
        var cachedTexture;
        if (cacheKey) {
          cachedTexture = this.getCachedTexture(cacheKey, source);
        }
        var pipelineState = {
          originalWidth: source.width || source.originalWidth,
          originalHeight: source.height || source.originalHeight,
          sourceWidth: width,
          sourceHeight: height,
          destinationWidth: width,
          destinationHeight: height,
          context: gl,
          sourceTexture: this.createTexture(
            gl,
            width,
            height,
            !cachedTexture && source
          ),
          targetTexture: this.createTexture(gl, width, height),
          originalTexture:
            cachedTexture ||
            this.createTexture(gl, width, height, !cachedTexture && source),
          passes: filters.length,
          webgl: true,
          aPosition: this.aPosition,
          programCache: this.programCache,
          pass: 0,
          filterBackend: this,
          targetCanvas: targetCanvas,
        };
        var tempFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFbo);
        filters.forEach(function (filter) {
          filter && filter.applyTo(pipelineState);
        });
        resizeCanvasIfNeeded(pipelineState);
        this.copyGLTo2D(gl, pipelineState);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.deleteTexture(pipelineState.sourceTexture);
        gl.deleteTexture(pipelineState.targetTexture);
        gl.deleteFramebuffer(tempFbo);
        targetCanvas.getContext('2d').setTransform(1, 0, 0, 1, 0, 0);
        return pipelineState;
      },

      /**
       * Detach event listeners, remove references, and clean up caches.
       */
      dispose: function () {
        if (this.canvas) {
          this.canvas = null;
          this.gl = null;
        }
        this.clearWebGLCaches();
      },

      /**
       * Wipe out WebGL-related caches.
       */
      clearWebGLCaches: function () {
        this.programCache = {};
        this.textureCache = {};
      },

      /**
       * Converts HTML image to Uint8Array.
       *
       * @param {HTMLImageElement} image A HTML image.
       * @param {CanvasRenderingContext2D} context Rendering context.
       *
       * @returns {Uint8Array} Image buffer.
       */
      imageToUint8Array: function (image, context) {
        const canvas = fabric.util.createCanvasElement();
        canvas.width = image.width;
        canvas.height = image.height;
        context = canvas.getContext('2d');

        context.drawImage(image, 0, 0);
        var buffer = context.getImageData(0, 0, image.width, image.height);

        return new Uint8Array(buffer.data.buffer);
      },

      /**
       * Create a WebGL texture object.
       *
       * Accepts specific dimensions to initialize the texture to or a source image.
       *
       * @param {WebGLRenderingContext} gl The GL context to use for creating the texture.
       * @param {Number} width The width to initialize the texture at.
       * @param {Number} height The height to initialize the texture.
       * @param {HTMLImageElement|HTMLCanvasElement} textureImageSource A source for the texture data.
       * @returns {WebGLTexture}
       */
      createTexture: function (gl, width, height, textureImageSource) {
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        var textureImageData = textureImageSource
          ? this.imageToUint8Array(
              textureImageSource,
              this._conversionCanvasEl.getContext('2d')
            )
          : null;

        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          width,
          height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          textureImageData
        );

        return texture;
      },

      /**
       * Can be optionally used to get a texture from the cache array
       *
       * If an existing texture is not found, a new texture is created and cached.
       *
       * @param {String} uniqueId A cache key to use to find an existing texture.
       * @param {HTMLImageElement|HTMLCanvasElement} textureImageSource A source to use to create the
       * texture cache entry if one does not already exist.
       */
      getCachedTexture: function (uniqueId, textureImageSource) {
        if (this.textureCache[uniqueId]) {
          return this.textureCache[uniqueId];
        } else {
          var texture = this.createTexture(
            this.gl,
            textureImageSource.width,
            textureImageSource.height,
            textureImageSource
          );
          this.textureCache[uniqueId] = texture;
          return texture;
        }
      },

      /**
       * Clear out cached resources related to a source image that has been
       * filtered previously.
       *
       * @param {String} cacheKey The cache key provided when the source image was filtered.
       */
      evictCachesForKey: function (cacheKey) {
        if (this.textureCache[cacheKey]) {
          this.gl.deleteTexture(this.textureCache[cacheKey]);
          delete this.textureCache[cacheKey];
        }
      },

      copyGLTo2D: copyGLTo2DPutImageData,

      /**
       * Attempt to extract GPU information strings from a WebGL context.
       *
       * Useful information when debugging or blacklisting specific GPUs.
       *
       * @returns {Object} A GPU info object with renderer and vendor strings.
       */
      captureGPUInfo: function () {
        if (this.gpuInfo) {
          return this.gpuInfo;
        }
        var gl = this.gl,
          gpuInfo = { renderer: '', vendor: '' };
        if (!gl) {
          return gpuInfo;
        }
        var ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          var renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
          var vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
          if (renderer) {
            gpuInfo.renderer = renderer.toLowerCase();
          }
          if (vendor) {
            gpuInfo.vendor = vendor.toLowerCase();
          }
        }
        this.gpuInfo = gpuInfo;
        return gpuInfo;
      },
    };
})(typeof exports !== 'undefined' ? exports : window);

function resizeCanvasIfNeeded(pipelineState) {
  var targetCanvas = pipelineState.targetCanvas,
    width = targetCanvas.width,
    height = targetCanvas.height,
    dWidth = pipelineState.destinationWidth,
    dHeight = pipelineState.destinationHeight;

  if (width !== dWidth || height !== dHeight) {
    targetCanvas.width = dWidth;
    targetCanvas.height = dHeight;
  }
}

/**
 * Copy an input WebGL canvas on to an output 2D canvas using 2d canvas' putImageData
 * API. Measurably faster than using ctx.drawImage in Firefox (version 54 on OSX Sierra).
 *
 * @param {WebGLRenderingContext} sourceContext The WebGL context to copy from.
 * @param {HTMLCanvasElement} targetCanvas The 2D target canvas to copy on to.
 * @param {Object} pipelineState The 2D target canvas to copy on to.
 */
function copyGLTo2DPutImageData(gl, pipelineState) {
  var targetCanvas = pipelineState.targetCanvas,
    ctx = targetCanvas.getContext('2d'),
    dWidth = pipelineState.destinationWidth,
    dHeight = pipelineState.destinationHeight,
    numBytes = dWidth * dHeight * 4;

  // eslint-disable-next-line no-undef
  var u8 = new Uint8Array(this.imageBuffer, 0, numBytes);
  // eslint-disable-next-line no-undef
  var u8Clamped = new Uint8ClampedArray(this.imageBuffer, 0, numBytes);

  gl.readPixels(0, 0, dWidth, dHeight, gl.RGBA, gl.UNSIGNED_BYTE, u8);

  var imgData = createImageData(u8Clamped, dWidth, dHeight);
  ctx.putImageData(imgData, 0, 0);
}
