//@ts-nocheck

import { fabric } from '../../HEADER';
import { createCanvasElement } from '../util/misc/dom';

export const enum TWebGLPrecision {
  low = 'lowp',
  medium = 'mediump',
  high = 'highp',
}

/**
 * @todo remove once rollup supports transforming enums...
 * https://github.com/rollup/plugins/issues/463
 */
const WebGLPrecision = [
  TWebGLPrecision.low,
  TWebGLPrecision.medium,
  TWebGLPrecision.high,
];

/**
 * Lazy initialize WebGL contants
 */
class WebGLProbe {
  private initialized = false;

  private _maxTextureSize?: number;

  private _webGLPrecision?: TWebGLPrecision;

  get maxTextureSize() {
    this.queryWebGL();
    return this._maxTextureSize;
  }

  get webGLPrecision() {
    this.queryWebGL();
    return this._webGLPrecision;
  }

  /**
   * Tests if webgl supports certain precision
   * @param {WebGL} Canvas WebGL context to test on
   * @param {TWebGLPrecision} Precision to test can be any of following
   * @returns {Boolean} Whether the user's browser WebGL supports given precision.
   */
  private testPrecision(gl: WebGLRenderingContext, precision: TWebGLPrecision) {
    const fragmentSource = `precision ${precision} float;\nvoid main(){}`;
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentSource);
    gl.compileShader(fragmentShader);
    return !!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS);
  }

  /**
   * query browser for WebGL
   * @returns config object if true
   */
  private queryWebGL() {
    if (this.initialized) {
      return;
    }

    let gl;
    
    if (fabric.isLikelyNode) {
      const width = 4;
      const height = 4;
      gl = require('gl')(width, height);

      if (!gl) {
        return;
      }
    } else {
      const canvas = createCanvasElement();
      gl =
        canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    }

    if (gl) {
      this._maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      this._webGLPrecision = WebGLPrecision.find((key) =>
        this.testPrecision(gl, key)
      );

      console.log(`fabric: max texture size ${this._maxTextureSize}`);
    }

    if (fabric.isLikelyNode) {
      const ext = gl.getExtension('STACKGL_destroy_context');
      ext.destroy();
    }

    this.initialized = true;
  }

  isSupported(textureSize: number) {
    return this.maxTextureSize && this.maxTextureSize >= textureSize;
  }
}

export const webGLProbe = new WebGLProbe();
