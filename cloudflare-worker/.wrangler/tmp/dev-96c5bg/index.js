var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
// @__NO_SIDE_EFFECTS__
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
var init_utils = __esm({
  "node_modules/unenv/dist/runtime/_internal/utils.mjs"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    __name(createNotImplementedError, "createNotImplementedError");
    __name(notImplemented, "notImplemented");
    __name(notImplementedClass, "notImplementedClass");
  }
});

// node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin, _performanceNow, nodeTiming, PerformanceEntry, PerformanceMark, PerformanceMeasure, PerformanceResourceTiming, PerformanceObserverEntryList, Performance, PerformanceObserver, performance;
var init_performance = __esm({
  "node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_utils();
    _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
    _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
    nodeTiming = {
      name: "node",
      entryType: "node",
      startTime: 0,
      duration: 0,
      nodeStart: 0,
      v8Start: 0,
      bootstrapComplete: 0,
      environment: 0,
      loopStart: 0,
      loopExit: 0,
      idleTime: 0,
      uvMetricsInfo: {
        loopCount: 0,
        events: 0,
        eventsWaiting: 0
      },
      detail: void 0,
      toJSON() {
        return this;
      }
    };
    PerformanceEntry = class {
      static {
        __name(this, "PerformanceEntry");
      }
      __unenv__ = true;
      detail;
      entryType = "event";
      name;
      startTime;
      constructor(name, options) {
        this.name = name;
        this.startTime = options?.startTime || _performanceNow();
        this.detail = options?.detail;
      }
      get duration() {
        return _performanceNow() - this.startTime;
      }
      toJSON() {
        return {
          name: this.name,
          entryType: this.entryType,
          startTime: this.startTime,
          duration: this.duration,
          detail: this.detail
        };
      }
    };
    PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
      static {
        __name(this, "PerformanceMark");
      }
      entryType = "mark";
      constructor() {
        super(...arguments);
      }
      get duration() {
        return 0;
      }
    };
    PerformanceMeasure = class extends PerformanceEntry {
      static {
        __name(this, "PerformanceMeasure");
      }
      entryType = "measure";
    };
    PerformanceResourceTiming = class extends PerformanceEntry {
      static {
        __name(this, "PerformanceResourceTiming");
      }
      entryType = "resource";
      serverTiming = [];
      connectEnd = 0;
      connectStart = 0;
      decodedBodySize = 0;
      domainLookupEnd = 0;
      domainLookupStart = 0;
      encodedBodySize = 0;
      fetchStart = 0;
      initiatorType = "";
      name = "";
      nextHopProtocol = "";
      redirectEnd = 0;
      redirectStart = 0;
      requestStart = 0;
      responseEnd = 0;
      responseStart = 0;
      secureConnectionStart = 0;
      startTime = 0;
      transferSize = 0;
      workerStart = 0;
      responseStatus = 0;
    };
    PerformanceObserverEntryList = class {
      static {
        __name(this, "PerformanceObserverEntryList");
      }
      __unenv__ = true;
      getEntries() {
        return [];
      }
      getEntriesByName(_name, _type) {
        return [];
      }
      getEntriesByType(type) {
        return [];
      }
    };
    Performance = class {
      static {
        __name(this, "Performance");
      }
      __unenv__ = true;
      timeOrigin = _timeOrigin;
      eventCounts = /* @__PURE__ */ new Map();
      _entries = [];
      _resourceTimingBufferSize = 0;
      navigation = void 0;
      timing = void 0;
      timerify(_fn, _options) {
        throw createNotImplementedError("Performance.timerify");
      }
      get nodeTiming() {
        return nodeTiming;
      }
      eventLoopUtilization() {
        return {};
      }
      markResourceTiming() {
        return new PerformanceResourceTiming("");
      }
      onresourcetimingbufferfull = null;
      now() {
        if (this.timeOrigin === _timeOrigin) {
          return _performanceNow();
        }
        return Date.now() - this.timeOrigin;
      }
      clearMarks(markName) {
        this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
      }
      clearMeasures(measureName) {
        this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
      }
      clearResourceTimings() {
        this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
      }
      getEntries() {
        return this._entries;
      }
      getEntriesByName(name, type) {
        return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
      }
      getEntriesByType(type) {
        return this._entries.filter((e) => e.entryType === type);
      }
      mark(name, options) {
        const entry = new PerformanceMark(name, options);
        this._entries.push(entry);
        return entry;
      }
      measure(measureName, startOrMeasureOptions, endMark) {
        let start;
        let end;
        if (typeof startOrMeasureOptions === "string") {
          start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
          end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
        } else {
          start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
          end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
        }
        const entry = new PerformanceMeasure(measureName, {
          startTime: start,
          detail: {
            start,
            end
          }
        });
        this._entries.push(entry);
        return entry;
      }
      setResourceTimingBufferSize(maxSize) {
        this._resourceTimingBufferSize = maxSize;
      }
      addEventListener(type, listener, options) {
        throw createNotImplementedError("Performance.addEventListener");
      }
      removeEventListener(type, listener, options) {
        throw createNotImplementedError("Performance.removeEventListener");
      }
      dispatchEvent(event) {
        throw createNotImplementedError("Performance.dispatchEvent");
      }
      toJSON() {
        return this;
      }
    };
    PerformanceObserver = class {
      static {
        __name(this, "PerformanceObserver");
      }
      __unenv__ = true;
      static supportedEntryTypes = [];
      _callback = null;
      constructor(callback) {
        this._callback = callback;
      }
      takeRecords() {
        return [];
      }
      disconnect() {
        throw createNotImplementedError("PerformanceObserver.disconnect");
      }
      observe(options) {
        throw createNotImplementedError("PerformanceObserver.observe");
      }
      bind(fn) {
        return fn;
      }
      runInAsyncScope(fn, thisArg, ...args) {
        return fn.call(thisArg, ...args);
      }
      asyncId() {
        return 0;
      }
      triggerAsyncId() {
        return 0;
      }
      emitDestroy() {
        return this;
      }
    };
    performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();
  }
});

// node_modules/unenv/dist/runtime/node/perf_hooks.mjs
var init_perf_hooks = __esm({
  "node_modules/unenv/dist/runtime/node/perf_hooks.mjs"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_performance();
  }
});

// node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
var init_performance2 = __esm({
  "node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs"() {
    init_perf_hooks();
    if (!("__unenv__" in performance)) {
      const proto = Performance.prototype;
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key !== "constructor" && !(key in performance)) {
          const desc = Object.getOwnPropertyDescriptor(proto, key);
          if (desc) {
            Object.defineProperty(performance, key, desc);
          }
        }
      }
    }
    globalThis.performance = performance;
    globalThis.Performance = Performance;
    globalThis.PerformanceEntry = PerformanceEntry;
    globalThis.PerformanceMark = PerformanceMark;
    globalThis.PerformanceMeasure = PerformanceMeasure;
    globalThis.PerformanceObserver = PerformanceObserver;
    globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
    globalThis.PerformanceResourceTiming = PerformanceResourceTiming;
  }
});

// node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default;
var init_noop = __esm({
  "node_modules/unenv/dist/runtime/mock/noop.mjs"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    noop_default = Object.assign(() => {
    }, { __unenv__: true });
  }
});

// node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";
var _console, _ignoreErrors, _stderr, _stdout, log, info, trace, debug, table, error, warn, createTask, clear, count, countReset, dir, dirxml, group, groupEnd, groupCollapsed, profile, profileEnd, time, timeEnd, timeLog, timeStamp, Console, _times, _stdoutErrorHandler, _stderrErrorHandler;
var init_console = __esm({
  "node_modules/unenv/dist/runtime/node/console.mjs"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_noop();
    init_utils();
    _console = globalThis.console;
    _ignoreErrors = true;
    _stderr = new Writable();
    _stdout = new Writable();
    log = _console?.log ?? noop_default;
    info = _console?.info ?? log;
    trace = _console?.trace ?? info;
    debug = _console?.debug ?? log;
    table = _console?.table ?? log;
    error = _console?.error ?? log;
    warn = _console?.warn ?? error;
    createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
    clear = _console?.clear ?? noop_default;
    count = _console?.count ?? noop_default;
    countReset = _console?.countReset ?? noop_default;
    dir = _console?.dir ?? noop_default;
    dirxml = _console?.dirxml ?? noop_default;
    group = _console?.group ?? noop_default;
    groupEnd = _console?.groupEnd ?? noop_default;
    groupCollapsed = _console?.groupCollapsed ?? noop_default;
    profile = _console?.profile ?? noop_default;
    profileEnd = _console?.profileEnd ?? noop_default;
    time = _console?.time ?? noop_default;
    timeEnd = _console?.timeEnd ?? noop_default;
    timeLog = _console?.timeLog ?? noop_default;
    timeStamp = _console?.timeStamp ?? noop_default;
    Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
    _times = /* @__PURE__ */ new Map();
    _stdoutErrorHandler = noop_default;
    _stderrErrorHandler = noop_default;
  }
});

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole, assert, clear2, context, count2, countReset2, createTask2, debug2, dir2, dirxml2, error2, group2, groupCollapsed2, groupEnd2, info2, log2, profile2, profileEnd2, table2, time2, timeEnd2, timeLog2, timeStamp2, trace2, warn2, console_default;
var init_console2 = __esm({
  "node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_console();
    workerdConsole = globalThis["console"];
    ({
      assert,
      clear: clear2,
      context: (
        // @ts-expect-error undocumented public API
        context
      ),
      count: count2,
      countReset: countReset2,
      createTask: (
        // @ts-expect-error undocumented public API
        createTask2
      ),
      debug: debug2,
      dir: dir2,
      dirxml: dirxml2,
      error: error2,
      group: group2,
      groupCollapsed: groupCollapsed2,
      groupEnd: groupEnd2,
      info: info2,
      log: log2,
      profile: profile2,
      profileEnd: profileEnd2,
      table: table2,
      time: time2,
      timeEnd: timeEnd2,
      timeLog: timeLog2,
      timeStamp: timeStamp2,
      trace: trace2,
      warn: warn2
    } = workerdConsole);
    Object.assign(workerdConsole, {
      Console,
      _ignoreErrors,
      _stderr,
      _stderrErrorHandler,
      _stdout,
      _stdoutErrorHandler,
      _times
    });
    console_default = workerdConsole;
  }
});

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
var init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console = __esm({
  "node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console"() {
    init_console2();
    globalThis.console = console_default;
  }
});

// node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime;
var init_hrtime = __esm({
  "node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
      const now = Date.now();
      const seconds = Math.trunc(now / 1e3);
      const nanos = now % 1e3 * 1e6;
      if (startTime) {
        let diffSeconds = seconds - startTime[0];
        let diffNanos = nanos - startTime[0];
        if (diffNanos < 0) {
          diffSeconds = diffSeconds - 1;
          diffNanos = 1e9 + diffNanos;
        }
        return [diffSeconds, diffNanos];
      }
      return [seconds, nanos];
    }, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
      return BigInt(Date.now() * 1e6);
    }, "bigint") });
  }
});

// node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream;
var init_read_stream = __esm({
  "node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    ReadStream = class {
      static {
        __name(this, "ReadStream");
      }
      fd;
      isRaw = false;
      isTTY = false;
      constructor(fd) {
        this.fd = fd;
      }
      setRawMode(mode) {
        this.isRaw = mode;
        return this;
      }
    };
  }
});

// node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream;
var init_write_stream = __esm({
  "node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    WriteStream = class {
      static {
        __name(this, "WriteStream");
      }
      fd;
      columns = 80;
      rows = 24;
      isTTY = false;
      constructor(fd) {
        this.fd = fd;
      }
      clearLine(dir3, callback) {
        callback && callback();
        return false;
      }
      clearScreenDown(callback) {
        callback && callback();
        return false;
      }
      cursorTo(x, y, callback) {
        callback && typeof callback === "function" && callback();
        return false;
      }
      moveCursor(dx, dy, callback) {
        callback && callback();
        return false;
      }
      getColorDepth(env2) {
        return 1;
      }
      hasColors(count3, env2) {
        return false;
      }
      getWindowSize() {
        return [this.columns, this.rows];
      }
      write(str, encoding, cb) {
        if (str instanceof Uint8Array) {
          str = new TextDecoder().decode(str);
        }
        try {
          console.log(str);
        } catch {
        }
        cb && typeof cb === "function" && cb();
        return false;
      }
    };
  }
});

// node_modules/unenv/dist/runtime/node/tty.mjs
var init_tty = __esm({
  "node_modules/unenv/dist/runtime/node/tty.mjs"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_read_stream();
    init_write_stream();
  }
});

// node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION;
var init_node_version = __esm({
  "node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    NODE_VERSION = "22.14.0";
  }
});

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";
var Process;
var init_process = __esm({
  "node_modules/unenv/dist/runtime/node/internal/process/process.mjs"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_tty();
    init_utils();
    init_node_version();
    Process = class _Process extends EventEmitter {
      static {
        __name(this, "Process");
      }
      env;
      hrtime;
      nextTick;
      constructor(impl) {
        super();
        this.env = impl.env;
        this.hrtime = impl.hrtime;
        this.nextTick = impl.nextTick;
        for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
          const value = this[prop];
          if (typeof value === "function") {
            this[prop] = value.bind(this);
          }
        }
      }
      // --- event emitter ---
      emitWarning(warning, type, code) {
        console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
      }
      emit(...args) {
        return super.emit(...args);
      }
      listeners(eventName) {
        return super.listeners(eventName);
      }
      // --- stdio (lazy initializers) ---
      #stdin;
      #stdout;
      #stderr;
      get stdin() {
        return this.#stdin ??= new ReadStream(0);
      }
      get stdout() {
        return this.#stdout ??= new WriteStream(1);
      }
      get stderr() {
        return this.#stderr ??= new WriteStream(2);
      }
      // --- cwd ---
      #cwd = "/";
      chdir(cwd2) {
        this.#cwd = cwd2;
      }
      cwd() {
        return this.#cwd;
      }
      // --- dummy props and getters ---
      arch = "";
      platform = "";
      argv = [];
      argv0 = "";
      execArgv = [];
      execPath = "";
      title = "";
      pid = 200;
      ppid = 100;
      get version() {
        return `v${NODE_VERSION}`;
      }
      get versions() {
        return { node: NODE_VERSION };
      }
      get allowedNodeEnvironmentFlags() {
        return /* @__PURE__ */ new Set();
      }
      get sourceMapsEnabled() {
        return false;
      }
      get debugPort() {
        return 0;
      }
      get throwDeprecation() {
        return false;
      }
      get traceDeprecation() {
        return false;
      }
      get features() {
        return {};
      }
      get release() {
        return {};
      }
      get connected() {
        return false;
      }
      get config() {
        return {};
      }
      get moduleLoadList() {
        return [];
      }
      constrainedMemory() {
        return 0;
      }
      availableMemory() {
        return 0;
      }
      uptime() {
        return 0;
      }
      resourceUsage() {
        return {};
      }
      // --- noop methods ---
      ref() {
      }
      unref() {
      }
      // --- unimplemented methods ---
      umask() {
        throw createNotImplementedError("process.umask");
      }
      getBuiltinModule() {
        return void 0;
      }
      getActiveResourcesInfo() {
        throw createNotImplementedError("process.getActiveResourcesInfo");
      }
      exit() {
        throw createNotImplementedError("process.exit");
      }
      reallyExit() {
        throw createNotImplementedError("process.reallyExit");
      }
      kill() {
        throw createNotImplementedError("process.kill");
      }
      abort() {
        throw createNotImplementedError("process.abort");
      }
      dlopen() {
        throw createNotImplementedError("process.dlopen");
      }
      setSourceMapsEnabled() {
        throw createNotImplementedError("process.setSourceMapsEnabled");
      }
      loadEnvFile() {
        throw createNotImplementedError("process.loadEnvFile");
      }
      disconnect() {
        throw createNotImplementedError("process.disconnect");
      }
      cpuUsage() {
        throw createNotImplementedError("process.cpuUsage");
      }
      setUncaughtExceptionCaptureCallback() {
        throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
      }
      hasUncaughtExceptionCaptureCallback() {
        throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
      }
      initgroups() {
        throw createNotImplementedError("process.initgroups");
      }
      openStdin() {
        throw createNotImplementedError("process.openStdin");
      }
      assert() {
        throw createNotImplementedError("process.assert");
      }
      binding() {
        throw createNotImplementedError("process.binding");
      }
      // --- attached interfaces ---
      permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
      report = {
        directory: "",
        filename: "",
        signal: "SIGUSR2",
        compact: false,
        reportOnFatalError: false,
        reportOnSignal: false,
        reportOnUncaughtException: false,
        getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
        writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
      };
      finalization = {
        register: /* @__PURE__ */ notImplemented("process.finalization.register"),
        unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
        registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
      };
      memoryUsage = Object.assign(() => ({
        arrayBuffers: 0,
        rss: 0,
        external: 0,
        heapTotal: 0,
        heapUsed: 0
      }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
      // --- undefined props ---
      mainModule = void 0;
      domain = void 0;
      // optional
      send = void 0;
      exitCode = void 0;
      channel = void 0;
      getegid = void 0;
      geteuid = void 0;
      getgid = void 0;
      getgroups = void 0;
      getuid = void 0;
      setegid = void 0;
      seteuid = void 0;
      setgid = void 0;
      setgroups = void 0;
      setuid = void 0;
      // internals
      _events = void 0;
      _eventsCount = void 0;
      _exiting = void 0;
      _maxListeners = void 0;
      _debugEnd = void 0;
      _debugProcess = void 0;
      _fatalException = void 0;
      _getActiveHandles = void 0;
      _getActiveRequests = void 0;
      _kill = void 0;
      _preload_modules = void 0;
      _rawDebug = void 0;
      _startProfilerIdleNotifier = void 0;
      _stopProfilerIdleNotifier = void 0;
      _tickCallback = void 0;
      _disconnect = void 0;
      _handleQueue = void 0;
      _pendingMessage = void 0;
      _channel = void 0;
      _send = void 0;
      _linkedBinding = void 0;
    };
  }
});

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess, getBuiltinModule, workerdProcess, unenvProcess, exit, features, platform, _channel, _debugEnd, _debugProcess, _disconnect, _events, _eventsCount, _exiting, _fatalException, _getActiveHandles, _getActiveRequests, _handleQueue, _kill, _linkedBinding, _maxListeners, _pendingMessage, _preload_modules, _rawDebug, _send, _startProfilerIdleNotifier, _stopProfilerIdleNotifier, _tickCallback, abort, addListener, allowedNodeEnvironmentFlags, arch, argv, argv0, assert2, availableMemory, binding, channel, chdir, config, connected, constrainedMemory, cpuUsage, cwd, debugPort, disconnect, dlopen, domain, emit, emitWarning, env, eventNames, execArgv, execPath, exitCode, finalization, getActiveResourcesInfo, getegid, geteuid, getgid, getgroups, getMaxListeners, getuid, hasUncaughtExceptionCaptureCallback, hrtime3, initgroups, kill, listenerCount, listeners, loadEnvFile, mainModule, memoryUsage, moduleLoadList, nextTick, off, on, once, openStdin, permission, pid, ppid, prependListener, prependOnceListener, rawListeners, reallyExit, ref, release, removeAllListeners, removeListener, report, resourceUsage, send, setegid, seteuid, setgid, setgroups, setMaxListeners, setSourceMapsEnabled, setuid, setUncaughtExceptionCaptureCallback, sourceMapsEnabled, stderr, stdin, stdout, throwDeprecation, title, traceDeprecation, umask, unref, uptime, version, versions, _process, process_default;
var init_process2 = __esm({
  "node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_hrtime();
    init_process();
    globalProcess = globalThis["process"];
    getBuiltinModule = globalProcess.getBuiltinModule;
    workerdProcess = getBuiltinModule("node:process");
    unenvProcess = new Process({
      env: globalProcess.env,
      hrtime,
      // `nextTick` is available from workerd process v1
      nextTick: workerdProcess.nextTick
    });
    ({ exit, features, platform } = workerdProcess);
    ({
      _channel,
      _debugEnd,
      _debugProcess,
      _disconnect,
      _events,
      _eventsCount,
      _exiting,
      _fatalException,
      _getActiveHandles,
      _getActiveRequests,
      _handleQueue,
      _kill,
      _linkedBinding,
      _maxListeners,
      _pendingMessage,
      _preload_modules,
      _rawDebug,
      _send,
      _startProfilerIdleNotifier,
      _stopProfilerIdleNotifier,
      _tickCallback,
      abort,
      addListener,
      allowedNodeEnvironmentFlags,
      arch,
      argv,
      argv0,
      assert: assert2,
      availableMemory,
      binding,
      channel,
      chdir,
      config,
      connected,
      constrainedMemory,
      cpuUsage,
      cwd,
      debugPort,
      disconnect,
      dlopen,
      domain,
      emit,
      emitWarning,
      env,
      eventNames,
      execArgv,
      execPath,
      exitCode,
      finalization,
      getActiveResourcesInfo,
      getegid,
      geteuid,
      getgid,
      getgroups,
      getMaxListeners,
      getuid,
      hasUncaughtExceptionCaptureCallback,
      hrtime: hrtime3,
      initgroups,
      kill,
      listenerCount,
      listeners,
      loadEnvFile,
      mainModule,
      memoryUsage,
      moduleLoadList,
      nextTick,
      off,
      on,
      once,
      openStdin,
      permission,
      pid,
      ppid,
      prependListener,
      prependOnceListener,
      rawListeners,
      reallyExit,
      ref,
      release,
      removeAllListeners,
      removeListener,
      report,
      resourceUsage,
      send,
      setegid,
      seteuid,
      setgid,
      setgroups,
      setMaxListeners,
      setSourceMapsEnabled,
      setuid,
      setUncaughtExceptionCaptureCallback,
      sourceMapsEnabled,
      stderr,
      stdin,
      stdout,
      throwDeprecation,
      title,
      traceDeprecation,
      umask,
      unref,
      uptime,
      version,
      versions
    } = unenvProcess);
    _process = {
      abort,
      addListener,
      allowedNodeEnvironmentFlags,
      hasUncaughtExceptionCaptureCallback,
      setUncaughtExceptionCaptureCallback,
      loadEnvFile,
      sourceMapsEnabled,
      arch,
      argv,
      argv0,
      chdir,
      config,
      connected,
      constrainedMemory,
      availableMemory,
      cpuUsage,
      cwd,
      debugPort,
      dlopen,
      disconnect,
      emit,
      emitWarning,
      env,
      eventNames,
      execArgv,
      execPath,
      exit,
      finalization,
      features,
      getBuiltinModule,
      getActiveResourcesInfo,
      getMaxListeners,
      hrtime: hrtime3,
      kill,
      listeners,
      listenerCount,
      memoryUsage,
      nextTick,
      on,
      off,
      once,
      pid,
      platform,
      ppid,
      prependListener,
      prependOnceListener,
      rawListeners,
      release,
      removeAllListeners,
      removeListener,
      report,
      resourceUsage,
      setMaxListeners,
      setSourceMapsEnabled,
      stderr,
      stdin,
      stdout,
      title,
      throwDeprecation,
      traceDeprecation,
      umask,
      uptime,
      version,
      versions,
      // @ts-expect-error old API
      domain,
      initgroups,
      moduleLoadList,
      reallyExit,
      openStdin,
      assert: assert2,
      binding,
      send,
      exitCode,
      channel,
      getegid,
      geteuid,
      getgid,
      getgroups,
      getuid,
      setegid,
      seteuid,
      setgid,
      setgroups,
      setuid,
      permission,
      mainModule,
      _events,
      _eventsCount,
      _exiting,
      _maxListeners,
      _debugEnd,
      _debugProcess,
      _fatalException,
      _getActiveHandles,
      _getActiveRequests,
      _kill,
      _preload_modules,
      _rawDebug,
      _startProfilerIdleNotifier,
      _stopProfilerIdleNotifier,
      _tickCallback,
      _disconnect,
      _handleQueue,
      _pendingMessage,
      _channel,
      _send,
      _linkedBinding
    };
    process_default = _process;
  }
});

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
var init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process = __esm({
  "node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process"() {
    init_process2();
    globalThis.process = process_default;
  }
});

// wrangler-modules-watch:wrangler:modules-watch
var init_wrangler_modules_watch = __esm({
  "wrangler-modules-watch:wrangler:modules-watch"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
  }
});

// node_modules/wrangler/templates/modules-watch-stub.js
var init_modules_watch_stub = __esm({
  "node_modules/wrangler/templates/modules-watch-stub.js"() {
    init_wrangler_modules_watch();
  }
});

// node_modules/qrcode/lib/can-promise.js
var require_can_promise = __commonJS({
  "node_modules/qrcode/lib/can-promise.js"(exports, module) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = function() {
      return typeof Promise === "function" && Promise.prototype && Promise.prototype.then;
    };
  }
});

// node_modules/qrcode/lib/core/utils.js
var require_utils = __commonJS({
  "node_modules/qrcode/lib/core/utils.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var toSJISFunction;
    var CODEWORDS_COUNT = [
      0,
      // Not used
      26,
      44,
      70,
      100,
      134,
      172,
      196,
      242,
      292,
      346,
      404,
      466,
      532,
      581,
      655,
      733,
      815,
      901,
      991,
      1085,
      1156,
      1258,
      1364,
      1474,
      1588,
      1706,
      1828,
      1921,
      2051,
      2185,
      2323,
      2465,
      2611,
      2761,
      2876,
      3034,
      3196,
      3362,
      3532,
      3706
    ];
    exports.getSymbolSize = /* @__PURE__ */ __name(function getSymbolSize(version3) {
      if (!version3) throw new Error('"version" cannot be null or undefined');
      if (version3 < 1 || version3 > 40) throw new Error('"version" should be in range from 1 to 40');
      return version3 * 4 + 17;
    }, "getSymbolSize");
    exports.getSymbolTotalCodewords = /* @__PURE__ */ __name(function getSymbolTotalCodewords(version3) {
      return CODEWORDS_COUNT[version3];
    }, "getSymbolTotalCodewords");
    exports.getBCHDigit = function(data) {
      let digit = 0;
      while (data !== 0) {
        digit++;
        data >>>= 1;
      }
      return digit;
    };
    exports.setToSJISFunction = /* @__PURE__ */ __name(function setToSJISFunction(f) {
      if (typeof f !== "function") {
        throw new Error('"toSJISFunc" is not a valid function.');
      }
      toSJISFunction = f;
    }, "setToSJISFunction");
    exports.isKanjiModeEnabled = function() {
      return typeof toSJISFunction !== "undefined";
    };
    exports.toSJIS = /* @__PURE__ */ __name(function toSJIS(kanji) {
      return toSJISFunction(kanji);
    }, "toSJIS");
  }
});

// node_modules/qrcode/lib/core/error-correction-level.js
var require_error_correction_level = __commonJS({
  "node_modules/qrcode/lib/core/error-correction-level.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    exports.L = { bit: 1 };
    exports.M = { bit: 0 };
    exports.Q = { bit: 3 };
    exports.H = { bit: 2 };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "l":
        case "low":
          return exports.L;
        case "m":
        case "medium":
          return exports.M;
        case "q":
        case "quartile":
          return exports.Q;
        case "h":
        case "high":
          return exports.H;
        default:
          throw new Error("Unknown EC Level: " + string);
      }
    }
    __name(fromString, "fromString");
    exports.isValid = /* @__PURE__ */ __name(function isValid2(level) {
      return level && typeof level.bit !== "undefined" && level.bit >= 0 && level.bit < 4;
    }, "isValid");
    exports.from = /* @__PURE__ */ __name(function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    }, "from");
  }
});

// node_modules/qrcode/lib/core/bit-buffer.js
var require_bit_buffer = __commonJS({
  "node_modules/qrcode/lib/core/bit-buffer.js"(exports, module) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    function BitBuffer() {
      this.buffer = [];
      this.length = 0;
    }
    __name(BitBuffer, "BitBuffer");
    BitBuffer.prototype = {
      get: /* @__PURE__ */ __name(function(index) {
        const bufIndex = Math.floor(index / 8);
        return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) === 1;
      }, "get"),
      put: /* @__PURE__ */ __name(function(num, length) {
        for (let i2 = 0; i2 < length; i2++) {
          this.putBit((num >>> length - i2 - 1 & 1) === 1);
        }
      }, "put"),
      getLengthInBits: /* @__PURE__ */ __name(function() {
        return this.length;
      }, "getLengthInBits"),
      putBit: /* @__PURE__ */ __name(function(bit) {
        const bufIndex = Math.floor(this.length / 8);
        if (this.buffer.length <= bufIndex) {
          this.buffer.push(0);
        }
        if (bit) {
          this.buffer[bufIndex] |= 128 >>> this.length % 8;
        }
        this.length++;
      }, "putBit")
    };
    module.exports = BitBuffer;
  }
});

// node_modules/qrcode/lib/core/bit-matrix.js
var require_bit_matrix = __commonJS({
  "node_modules/qrcode/lib/core/bit-matrix.js"(exports, module) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    function BitMatrix(size) {
      if (!size || size < 1) {
        throw new Error("BitMatrix size must be defined and greater than 0");
      }
      this.size = size;
      this.data = new Uint8Array(size * size);
      this.reservedBit = new Uint8Array(size * size);
    }
    __name(BitMatrix, "BitMatrix");
    BitMatrix.prototype.set = function(row, col, value, reserved) {
      const index = row * this.size + col;
      this.data[index] = value;
      if (reserved) this.reservedBit[index] = true;
    };
    BitMatrix.prototype.get = function(row, col) {
      return this.data[row * this.size + col];
    };
    BitMatrix.prototype.xor = function(row, col, value) {
      this.data[row * this.size + col] ^= value;
    };
    BitMatrix.prototype.isReserved = function(row, col) {
      return this.reservedBit[row * this.size + col];
    };
    module.exports = BitMatrix;
  }
});

// node_modules/qrcode/lib/core/alignment-pattern.js
var require_alignment_pattern = __commonJS({
  "node_modules/qrcode/lib/core/alignment-pattern.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var getSymbolSize = require_utils().getSymbolSize;
    exports.getRowColCoords = /* @__PURE__ */ __name(function getRowColCoords(version3) {
      if (version3 === 1) return [];
      const posCount = Math.floor(version3 / 7) + 2;
      const size = getSymbolSize(version3);
      const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
      const positions = [size - 7];
      for (let i2 = 1; i2 < posCount - 1; i2++) {
        positions[i2] = positions[i2 - 1] - intervals;
      }
      positions.push(6);
      return positions.reverse();
    }, "getRowColCoords");
    exports.getPositions = /* @__PURE__ */ __name(function getPositions(version3) {
      const coords = [];
      const pos = exports.getRowColCoords(version3);
      const posLength = pos.length;
      for (let i2 = 0; i2 < posLength; i2++) {
        for (let j = 0; j < posLength; j++) {
          if (i2 === 0 && j === 0 || // top-left
          i2 === 0 && j === posLength - 1 || // bottom-left
          i2 === posLength - 1 && j === 0) {
            continue;
          }
          coords.push([pos[i2], pos[j]]);
        }
      }
      return coords;
    }, "getPositions");
  }
});

// node_modules/qrcode/lib/core/finder-pattern.js
var require_finder_pattern = __commonJS({
  "node_modules/qrcode/lib/core/finder-pattern.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var getSymbolSize = require_utils().getSymbolSize;
    var FINDER_PATTERN_SIZE = 7;
    exports.getPositions = /* @__PURE__ */ __name(function getPositions(version3) {
      const size = getSymbolSize(version3);
      return [
        // top-left
        [0, 0],
        // top-right
        [size - FINDER_PATTERN_SIZE, 0],
        // bottom-left
        [0, size - FINDER_PATTERN_SIZE]
      ];
    }, "getPositions");
  }
});

// node_modules/qrcode/lib/core/mask-pattern.js
var require_mask_pattern = __commonJS({
  "node_modules/qrcode/lib/core/mask-pattern.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    exports.Patterns = {
      PATTERN000: 0,
      PATTERN001: 1,
      PATTERN010: 2,
      PATTERN011: 3,
      PATTERN100: 4,
      PATTERN101: 5,
      PATTERN110: 6,
      PATTERN111: 7
    };
    var PenaltyScores = {
      N1: 3,
      N2: 3,
      N3: 40,
      N4: 10
    };
    exports.isValid = /* @__PURE__ */ __name(function isValid2(mask) {
      return mask != null && mask !== "" && !isNaN(mask) && mask >= 0 && mask <= 7;
    }, "isValid");
    exports.from = /* @__PURE__ */ __name(function from(value) {
      return exports.isValid(value) ? parseInt(value, 10) : void 0;
    }, "from");
    exports.getPenaltyN1 = /* @__PURE__ */ __name(function getPenaltyN1(data) {
      const size = data.size;
      let points = 0;
      let sameCountCol = 0;
      let sameCountRow = 0;
      let lastCol = null;
      let lastRow = null;
      for (let row = 0; row < size; row++) {
        sameCountCol = sameCountRow = 0;
        lastCol = lastRow = null;
        for (let col = 0; col < size; col++) {
          let module2 = data.get(row, col);
          if (module2 === lastCol) {
            sameCountCol++;
          } else {
            if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
            lastCol = module2;
            sameCountCol = 1;
          }
          module2 = data.get(col, row);
          if (module2 === lastRow) {
            sameCountRow++;
          } else {
            if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
            lastRow = module2;
            sameCountRow = 1;
          }
        }
        if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
        if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
      }
      return points;
    }, "getPenaltyN1");
    exports.getPenaltyN2 = /* @__PURE__ */ __name(function getPenaltyN2(data) {
      const size = data.size;
      let points = 0;
      for (let row = 0; row < size - 1; row++) {
        for (let col = 0; col < size - 1; col++) {
          const last = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1);
          if (last === 4 || last === 0) points++;
        }
      }
      return points * PenaltyScores.N2;
    }, "getPenaltyN2");
    exports.getPenaltyN3 = /* @__PURE__ */ __name(function getPenaltyN3(data) {
      const size = data.size;
      let points = 0;
      let bitsCol = 0;
      let bitsRow = 0;
      for (let row = 0; row < size; row++) {
        bitsCol = bitsRow = 0;
        for (let col = 0; col < size; col++) {
          bitsCol = bitsCol << 1 & 2047 | data.get(row, col);
          if (col >= 10 && (bitsCol === 1488 || bitsCol === 93)) points++;
          bitsRow = bitsRow << 1 & 2047 | data.get(col, row);
          if (col >= 10 && (bitsRow === 1488 || bitsRow === 93)) points++;
        }
      }
      return points * PenaltyScores.N3;
    }, "getPenaltyN3");
    exports.getPenaltyN4 = /* @__PURE__ */ __name(function getPenaltyN4(data) {
      let darkCount = 0;
      const modulesCount = data.data.length;
      for (let i2 = 0; i2 < modulesCount; i2++) darkCount += data.data[i2];
      const k = Math.abs(Math.ceil(darkCount * 100 / modulesCount / 5) - 10);
      return k * PenaltyScores.N4;
    }, "getPenaltyN4");
    function getMaskAt(maskPattern, i2, j) {
      switch (maskPattern) {
        case exports.Patterns.PATTERN000:
          return (i2 + j) % 2 === 0;
        case exports.Patterns.PATTERN001:
          return i2 % 2 === 0;
        case exports.Patterns.PATTERN010:
          return j % 3 === 0;
        case exports.Patterns.PATTERN011:
          return (i2 + j) % 3 === 0;
        case exports.Patterns.PATTERN100:
          return (Math.floor(i2 / 2) + Math.floor(j / 3)) % 2 === 0;
        case exports.Patterns.PATTERN101:
          return i2 * j % 2 + i2 * j % 3 === 0;
        case exports.Patterns.PATTERN110:
          return (i2 * j % 2 + i2 * j % 3) % 2 === 0;
        case exports.Patterns.PATTERN111:
          return (i2 * j % 3 + (i2 + j) % 2) % 2 === 0;
        default:
          throw new Error("bad maskPattern:" + maskPattern);
      }
    }
    __name(getMaskAt, "getMaskAt");
    exports.applyMask = /* @__PURE__ */ __name(function applyMask(pattern, data) {
      const size = data.size;
      for (let col = 0; col < size; col++) {
        for (let row = 0; row < size; row++) {
          if (data.isReserved(row, col)) continue;
          data.xor(row, col, getMaskAt(pattern, row, col));
        }
      }
    }, "applyMask");
    exports.getBestMask = /* @__PURE__ */ __name(function getBestMask(data, setupFormatFunc) {
      const numPatterns = Object.keys(exports.Patterns).length;
      let bestPattern = 0;
      let lowerPenalty = Infinity;
      for (let p = 0; p < numPatterns; p++) {
        setupFormatFunc(p);
        exports.applyMask(p, data);
        const penalty = exports.getPenaltyN1(data) + exports.getPenaltyN2(data) + exports.getPenaltyN3(data) + exports.getPenaltyN4(data);
        exports.applyMask(p, data);
        if (penalty < lowerPenalty) {
          lowerPenalty = penalty;
          bestPattern = p;
        }
      }
      return bestPattern;
    }, "getBestMask");
  }
});

// node_modules/qrcode/lib/core/error-correction-code.js
var require_error_correction_code = __commonJS({
  "node_modules/qrcode/lib/core/error-correction-code.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var ECLevel = require_error_correction_level();
    var EC_BLOCKS_TABLE = [
      // L  M  Q  H
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      2,
      1,
      2,
      2,
      4,
      1,
      2,
      4,
      4,
      2,
      4,
      4,
      4,
      2,
      4,
      6,
      5,
      2,
      4,
      6,
      6,
      2,
      5,
      8,
      8,
      4,
      5,
      8,
      8,
      4,
      5,
      8,
      11,
      4,
      8,
      10,
      11,
      4,
      9,
      12,
      16,
      4,
      9,
      16,
      16,
      6,
      10,
      12,
      18,
      6,
      10,
      17,
      16,
      6,
      11,
      16,
      19,
      6,
      13,
      18,
      21,
      7,
      14,
      21,
      25,
      8,
      16,
      20,
      25,
      8,
      17,
      23,
      25,
      9,
      17,
      23,
      34,
      9,
      18,
      25,
      30,
      10,
      20,
      27,
      32,
      12,
      21,
      29,
      35,
      12,
      23,
      34,
      37,
      12,
      25,
      34,
      40,
      13,
      26,
      35,
      42,
      14,
      28,
      38,
      45,
      15,
      29,
      40,
      48,
      16,
      31,
      43,
      51,
      17,
      33,
      45,
      54,
      18,
      35,
      48,
      57,
      19,
      37,
      51,
      60,
      19,
      38,
      53,
      63,
      20,
      40,
      56,
      66,
      21,
      43,
      59,
      70,
      22,
      45,
      62,
      74,
      24,
      47,
      65,
      77,
      25,
      49,
      68,
      81
    ];
    var EC_CODEWORDS_TABLE = [
      // L  M  Q  H
      7,
      10,
      13,
      17,
      10,
      16,
      22,
      28,
      15,
      26,
      36,
      44,
      20,
      36,
      52,
      64,
      26,
      48,
      72,
      88,
      36,
      64,
      96,
      112,
      40,
      72,
      108,
      130,
      48,
      88,
      132,
      156,
      60,
      110,
      160,
      192,
      72,
      130,
      192,
      224,
      80,
      150,
      224,
      264,
      96,
      176,
      260,
      308,
      104,
      198,
      288,
      352,
      120,
      216,
      320,
      384,
      132,
      240,
      360,
      432,
      144,
      280,
      408,
      480,
      168,
      308,
      448,
      532,
      180,
      338,
      504,
      588,
      196,
      364,
      546,
      650,
      224,
      416,
      600,
      700,
      224,
      442,
      644,
      750,
      252,
      476,
      690,
      816,
      270,
      504,
      750,
      900,
      300,
      560,
      810,
      960,
      312,
      588,
      870,
      1050,
      336,
      644,
      952,
      1110,
      360,
      700,
      1020,
      1200,
      390,
      728,
      1050,
      1260,
      420,
      784,
      1140,
      1350,
      450,
      812,
      1200,
      1440,
      480,
      868,
      1290,
      1530,
      510,
      924,
      1350,
      1620,
      540,
      980,
      1440,
      1710,
      570,
      1036,
      1530,
      1800,
      570,
      1064,
      1590,
      1890,
      600,
      1120,
      1680,
      1980,
      630,
      1204,
      1770,
      2100,
      660,
      1260,
      1860,
      2220,
      720,
      1316,
      1950,
      2310,
      750,
      1372,
      2040,
      2430
    ];
    exports.getBlocksCount = /* @__PURE__ */ __name(function getBlocksCount(version3, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_BLOCKS_TABLE[(version3 - 1) * 4 + 0];
        case ECLevel.M:
          return EC_BLOCKS_TABLE[(version3 - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_BLOCKS_TABLE[(version3 - 1) * 4 + 2];
        case ECLevel.H:
          return EC_BLOCKS_TABLE[(version3 - 1) * 4 + 3];
        default:
          return void 0;
      }
    }, "getBlocksCount");
    exports.getTotalCodewordsCount = /* @__PURE__ */ __name(function getTotalCodewordsCount(version3, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_CODEWORDS_TABLE[(version3 - 1) * 4 + 0];
        case ECLevel.M:
          return EC_CODEWORDS_TABLE[(version3 - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_CODEWORDS_TABLE[(version3 - 1) * 4 + 2];
        case ECLevel.H:
          return EC_CODEWORDS_TABLE[(version3 - 1) * 4 + 3];
        default:
          return void 0;
      }
    }, "getTotalCodewordsCount");
  }
});

// node_modules/qrcode/lib/core/galois-field.js
var require_galois_field = __commonJS({
  "node_modules/qrcode/lib/core/galois-field.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var EXP_TABLE = new Uint8Array(512);
    var LOG_TABLE = new Uint8Array(256);
    (/* @__PURE__ */ __name(function initTables() {
      let x = 1;
      for (let i2 = 0; i2 < 255; i2++) {
        EXP_TABLE[i2] = x;
        LOG_TABLE[x] = i2;
        x <<= 1;
        if (x & 256) {
          x ^= 285;
        }
      }
      for (let i2 = 255; i2 < 512; i2++) {
        EXP_TABLE[i2] = EXP_TABLE[i2 - 255];
      }
    }, "initTables"))();
    exports.log = /* @__PURE__ */ __name(function log3(n2) {
      if (n2 < 1) throw new Error("log(" + n2 + ")");
      return LOG_TABLE[n2];
    }, "log");
    exports.exp = /* @__PURE__ */ __name(function exp(n2) {
      return EXP_TABLE[n2];
    }, "exp");
    exports.mul = /* @__PURE__ */ __name(function mul(x, y) {
      if (x === 0 || y === 0) return 0;
      return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
    }, "mul");
  }
});

// node_modules/qrcode/lib/core/polynomial.js
var require_polynomial = __commonJS({
  "node_modules/qrcode/lib/core/polynomial.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var GF = require_galois_field();
    exports.mul = /* @__PURE__ */ __name(function mul(p1, p2) {
      const coeff = new Uint8Array(p1.length + p2.length - 1);
      for (let i2 = 0; i2 < p1.length; i2++) {
        for (let j = 0; j < p2.length; j++) {
          coeff[i2 + j] ^= GF.mul(p1[i2], p2[j]);
        }
      }
      return coeff;
    }, "mul");
    exports.mod = /* @__PURE__ */ __name(function mod(divident, divisor) {
      let result = new Uint8Array(divident);
      while (result.length - divisor.length >= 0) {
        const coeff = result[0];
        for (let i2 = 0; i2 < divisor.length; i2++) {
          result[i2] ^= GF.mul(divisor[i2], coeff);
        }
        let offset = 0;
        while (offset < result.length && result[offset] === 0) offset++;
        result = result.slice(offset);
      }
      return result;
    }, "mod");
    exports.generateECPolynomial = /* @__PURE__ */ __name(function generateECPolynomial(degree) {
      let poly = new Uint8Array([1]);
      for (let i2 = 0; i2 < degree; i2++) {
        poly = exports.mul(poly, new Uint8Array([1, GF.exp(i2)]));
      }
      return poly;
    }, "generateECPolynomial");
  }
});

// node_modules/qrcode/lib/core/reed-solomon-encoder.js
var require_reed_solomon_encoder = __commonJS({
  "node_modules/qrcode/lib/core/reed-solomon-encoder.js"(exports, module) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var Polynomial = require_polynomial();
    function ReedSolomonEncoder(degree) {
      this.genPoly = void 0;
      this.degree = degree;
      if (this.degree) this.initialize(this.degree);
    }
    __name(ReedSolomonEncoder, "ReedSolomonEncoder");
    ReedSolomonEncoder.prototype.initialize = /* @__PURE__ */ __name(function initialize(degree) {
      this.degree = degree;
      this.genPoly = Polynomial.generateECPolynomial(this.degree);
    }, "initialize");
    ReedSolomonEncoder.prototype.encode = /* @__PURE__ */ __name(function encode3(data) {
      if (!this.genPoly) {
        throw new Error("Encoder not initialized");
      }
      const paddedData = new Uint8Array(data.length + this.degree);
      paddedData.set(data);
      const remainder = Polynomial.mod(paddedData, this.genPoly);
      const start = this.degree - remainder.length;
      if (start > 0) {
        const buff = new Uint8Array(this.degree);
        buff.set(remainder, start);
        return buff;
      }
      return remainder;
    }, "encode");
    module.exports = ReedSolomonEncoder;
  }
});

// node_modules/qrcode/lib/core/version-check.js
var require_version_check = __commonJS({
  "node_modules/qrcode/lib/core/version-check.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    exports.isValid = /* @__PURE__ */ __name(function isValid2(version3) {
      return !isNaN(version3) && version3 >= 1 && version3 <= 40;
    }, "isValid");
  }
});

// node_modules/qrcode/lib/core/regex.js
var require_regex = __commonJS({
  "node_modules/qrcode/lib/core/regex.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var numeric = "[0-9]+";
    var alphanumeric = "[A-Z $%*+\\-./:]+";
    var kanji = "(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";
    kanji = kanji.replace(/u/g, "\\u");
    var byte = "(?:(?![A-Z0-9 $%*+\\-./:]|" + kanji + ")(?:.|[\r\n]))+";
    exports.KANJI = new RegExp(kanji, "g");
    exports.BYTE_KANJI = new RegExp("[^A-Z0-9 $%*+\\-./:]+", "g");
    exports.BYTE = new RegExp(byte, "g");
    exports.NUMERIC = new RegExp(numeric, "g");
    exports.ALPHANUMERIC = new RegExp(alphanumeric, "g");
    var TEST_KANJI = new RegExp("^" + kanji + "$");
    var TEST_NUMERIC = new RegExp("^" + numeric + "$");
    var TEST_ALPHANUMERIC = new RegExp("^[A-Z0-9 $%*+\\-./:]+$");
    exports.testKanji = /* @__PURE__ */ __name(function testKanji(str) {
      return TEST_KANJI.test(str);
    }, "testKanji");
    exports.testNumeric = /* @__PURE__ */ __name(function testNumeric(str) {
      return TEST_NUMERIC.test(str);
    }, "testNumeric");
    exports.testAlphanumeric = /* @__PURE__ */ __name(function testAlphanumeric(str) {
      return TEST_ALPHANUMERIC.test(str);
    }, "testAlphanumeric");
  }
});

// node_modules/qrcode/lib/core/mode.js
var require_mode = __commonJS({
  "node_modules/qrcode/lib/core/mode.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var VersionCheck = require_version_check();
    var Regex = require_regex();
    exports.NUMERIC = {
      id: "Numeric",
      bit: 1 << 0,
      ccBits: [10, 12, 14]
    };
    exports.ALPHANUMERIC = {
      id: "Alphanumeric",
      bit: 1 << 1,
      ccBits: [9, 11, 13]
    };
    exports.BYTE = {
      id: "Byte",
      bit: 1 << 2,
      ccBits: [8, 16, 16]
    };
    exports.KANJI = {
      id: "Kanji",
      bit: 1 << 3,
      ccBits: [8, 10, 12]
    };
    exports.MIXED = {
      bit: -1
    };
    exports.getCharCountIndicator = /* @__PURE__ */ __name(function getCharCountIndicator(mode, version3) {
      if (!mode.ccBits) throw new Error("Invalid mode: " + mode);
      if (!VersionCheck.isValid(version3)) {
        throw new Error("Invalid version: " + version3);
      }
      if (version3 >= 1 && version3 < 10) return mode.ccBits[0];
      else if (version3 < 27) return mode.ccBits[1];
      return mode.ccBits[2];
    }, "getCharCountIndicator");
    exports.getBestModeForData = /* @__PURE__ */ __name(function getBestModeForData(dataStr) {
      if (Regex.testNumeric(dataStr)) return exports.NUMERIC;
      else if (Regex.testAlphanumeric(dataStr)) return exports.ALPHANUMERIC;
      else if (Regex.testKanji(dataStr)) return exports.KANJI;
      else return exports.BYTE;
    }, "getBestModeForData");
    exports.toString = /* @__PURE__ */ __name(function toString(mode) {
      if (mode && mode.id) return mode.id;
      throw new Error("Invalid mode");
    }, "toString");
    exports.isValid = /* @__PURE__ */ __name(function isValid2(mode) {
      return mode && mode.bit && mode.ccBits;
    }, "isValid");
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "numeric":
          return exports.NUMERIC;
        case "alphanumeric":
          return exports.ALPHANUMERIC;
        case "kanji":
          return exports.KANJI;
        case "byte":
          return exports.BYTE;
        default:
          throw new Error("Unknown mode: " + string);
      }
    }
    __name(fromString, "fromString");
    exports.from = /* @__PURE__ */ __name(function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    }, "from");
  }
});

// node_modules/qrcode/lib/core/version.js
var require_version = __commonJS({
  "node_modules/qrcode/lib/core/version.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var Utils = require_utils();
    var ECCode = require_error_correction_code();
    var ECLevel = require_error_correction_level();
    var Mode = require_mode();
    var VersionCheck = require_version_check();
    var G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
    var G18_BCH = Utils.getBCHDigit(G18);
    function getBestVersionForDataLength(mode, length, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, mode)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    __name(getBestVersionForDataLength, "getBestVersionForDataLength");
    function getReservedBitsCount(mode, version3) {
      return Mode.getCharCountIndicator(mode, version3) + 4;
    }
    __name(getReservedBitsCount, "getReservedBitsCount");
    function getTotalBitsFromDataArray(segments, version3) {
      let totalBits = 0;
      segments.forEach(function(data) {
        const reservedBits = getReservedBitsCount(data.mode, version3);
        totalBits += reservedBits + data.getBitsLength();
      });
      return totalBits;
    }
    __name(getTotalBitsFromDataArray, "getTotalBitsFromDataArray");
    function getBestVersionForMixedData(segments, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        const length = getTotalBitsFromDataArray(segments, currentVersion);
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, Mode.MIXED)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    __name(getBestVersionForMixedData, "getBestVersionForMixedData");
    exports.from = /* @__PURE__ */ __name(function from(value, defaultValue) {
      if (VersionCheck.isValid(value)) {
        return parseInt(value, 10);
      }
      return defaultValue;
    }, "from");
    exports.getCapacity = /* @__PURE__ */ __name(function getCapacity(version3, errorCorrectionLevel, mode) {
      if (!VersionCheck.isValid(version3)) {
        throw new Error("Invalid QR Code version");
      }
      if (typeof mode === "undefined") mode = Mode.BYTE;
      const totalCodewords = Utils.getSymbolTotalCodewords(version3);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version3, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (mode === Mode.MIXED) return dataTotalCodewordsBits;
      const usableBits = dataTotalCodewordsBits - getReservedBitsCount(mode, version3);
      switch (mode) {
        case Mode.NUMERIC:
          return Math.floor(usableBits / 10 * 3);
        case Mode.ALPHANUMERIC:
          return Math.floor(usableBits / 11 * 2);
        case Mode.KANJI:
          return Math.floor(usableBits / 13);
        case Mode.BYTE:
        default:
          return Math.floor(usableBits / 8);
      }
    }, "getCapacity");
    exports.getBestVersionForData = /* @__PURE__ */ __name(function getBestVersionForData(data, errorCorrectionLevel) {
      let seg;
      const ecl = ECLevel.from(errorCorrectionLevel, ECLevel.M);
      if (Array.isArray(data)) {
        if (data.length > 1) {
          return getBestVersionForMixedData(data, ecl);
        }
        if (data.length === 0) {
          return 1;
        }
        seg = data[0];
      } else {
        seg = data;
      }
      return getBestVersionForDataLength(seg.mode, seg.getLength(), ecl);
    }, "getBestVersionForData");
    exports.getEncodedBits = /* @__PURE__ */ __name(function getEncodedBits(version3) {
      if (!VersionCheck.isValid(version3) || version3 < 7) {
        throw new Error("Invalid QR Code version");
      }
      let d2 = version3 << 12;
      while (Utils.getBCHDigit(d2) - G18_BCH >= 0) {
        d2 ^= G18 << Utils.getBCHDigit(d2) - G18_BCH;
      }
      return version3 << 12 | d2;
    }, "getEncodedBits");
  }
});

// node_modules/qrcode/lib/core/format-info.js
var require_format_info = __commonJS({
  "node_modules/qrcode/lib/core/format-info.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var Utils = require_utils();
    var G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
    var G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
    var G15_BCH = Utils.getBCHDigit(G15);
    exports.getEncodedBits = /* @__PURE__ */ __name(function getEncodedBits(errorCorrectionLevel, mask) {
      const data = errorCorrectionLevel.bit << 3 | mask;
      let d2 = data << 10;
      while (Utils.getBCHDigit(d2) - G15_BCH >= 0) {
        d2 ^= G15 << Utils.getBCHDigit(d2) - G15_BCH;
      }
      return (data << 10 | d2) ^ G15_MASK;
    }, "getEncodedBits");
  }
});

// node_modules/qrcode/lib/core/numeric-data.js
var require_numeric_data = __commonJS({
  "node_modules/qrcode/lib/core/numeric-data.js"(exports, module) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var Mode = require_mode();
    function NumericData(data) {
      this.mode = Mode.NUMERIC;
      this.data = data.toString();
    }
    __name(NumericData, "NumericData");
    NumericData.getBitsLength = /* @__PURE__ */ __name(function getBitsLength(length) {
      return 10 * Math.floor(length / 3) + (length % 3 ? length % 3 * 3 + 1 : 0);
    }, "getBitsLength");
    NumericData.prototype.getLength = /* @__PURE__ */ __name(function getLength() {
      return this.data.length;
    }, "getLength");
    NumericData.prototype.getBitsLength = /* @__PURE__ */ __name(function getBitsLength() {
      return NumericData.getBitsLength(this.data.length);
    }, "getBitsLength");
    NumericData.prototype.write = /* @__PURE__ */ __name(function write(bitBuffer) {
      let i2, group3, value;
      for (i2 = 0; i2 + 3 <= this.data.length; i2 += 3) {
        group3 = this.data.substr(i2, 3);
        value = parseInt(group3, 10);
        bitBuffer.put(value, 10);
      }
      const remainingNum = this.data.length - i2;
      if (remainingNum > 0) {
        group3 = this.data.substr(i2);
        value = parseInt(group3, 10);
        bitBuffer.put(value, remainingNum * 3 + 1);
      }
    }, "write");
    module.exports = NumericData;
  }
});

// node_modules/qrcode/lib/core/alphanumeric-data.js
var require_alphanumeric_data = __commonJS({
  "node_modules/qrcode/lib/core/alphanumeric-data.js"(exports, module) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var Mode = require_mode();
    var ALPHA_NUM_CHARS = [
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
      "P",
      "Q",
      "R",
      "S",
      "T",
      "U",
      "V",
      "W",
      "X",
      "Y",
      "Z",
      " ",
      "$",
      "%",
      "*",
      "+",
      "-",
      ".",
      "/",
      ":"
    ];
    function AlphanumericData(data) {
      this.mode = Mode.ALPHANUMERIC;
      this.data = data;
    }
    __name(AlphanumericData, "AlphanumericData");
    AlphanumericData.getBitsLength = /* @__PURE__ */ __name(function getBitsLength(length) {
      return 11 * Math.floor(length / 2) + 6 * (length % 2);
    }, "getBitsLength");
    AlphanumericData.prototype.getLength = /* @__PURE__ */ __name(function getLength() {
      return this.data.length;
    }, "getLength");
    AlphanumericData.prototype.getBitsLength = /* @__PURE__ */ __name(function getBitsLength() {
      return AlphanumericData.getBitsLength(this.data.length);
    }, "getBitsLength");
    AlphanumericData.prototype.write = /* @__PURE__ */ __name(function write(bitBuffer) {
      let i2;
      for (i2 = 0; i2 + 2 <= this.data.length; i2 += 2) {
        let value = ALPHA_NUM_CHARS.indexOf(this.data[i2]) * 45;
        value += ALPHA_NUM_CHARS.indexOf(this.data[i2 + 1]);
        bitBuffer.put(value, 11);
      }
      if (this.data.length % 2) {
        bitBuffer.put(ALPHA_NUM_CHARS.indexOf(this.data[i2]), 6);
      }
    }, "write");
    module.exports = AlphanumericData;
  }
});

// node_modules/qrcode/lib/core/byte-data.js
var require_byte_data = __commonJS({
  "node_modules/qrcode/lib/core/byte-data.js"(exports, module) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var Mode = require_mode();
    function ByteData(data) {
      this.mode = Mode.BYTE;
      if (typeof data === "string") {
        this.data = new TextEncoder().encode(data);
      } else {
        this.data = new Uint8Array(data);
      }
    }
    __name(ByteData, "ByteData");
    ByteData.getBitsLength = /* @__PURE__ */ __name(function getBitsLength(length) {
      return length * 8;
    }, "getBitsLength");
    ByteData.prototype.getLength = /* @__PURE__ */ __name(function getLength() {
      return this.data.length;
    }, "getLength");
    ByteData.prototype.getBitsLength = /* @__PURE__ */ __name(function getBitsLength() {
      return ByteData.getBitsLength(this.data.length);
    }, "getBitsLength");
    ByteData.prototype.write = function(bitBuffer) {
      for (let i2 = 0, l = this.data.length; i2 < l; i2++) {
        bitBuffer.put(this.data[i2], 8);
      }
    };
    module.exports = ByteData;
  }
});

// node_modules/qrcode/lib/core/kanji-data.js
var require_kanji_data = __commonJS({
  "node_modules/qrcode/lib/core/kanji-data.js"(exports, module) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var Mode = require_mode();
    var Utils = require_utils();
    function KanjiData(data) {
      this.mode = Mode.KANJI;
      this.data = data;
    }
    __name(KanjiData, "KanjiData");
    KanjiData.getBitsLength = /* @__PURE__ */ __name(function getBitsLength(length) {
      return length * 13;
    }, "getBitsLength");
    KanjiData.prototype.getLength = /* @__PURE__ */ __name(function getLength() {
      return this.data.length;
    }, "getLength");
    KanjiData.prototype.getBitsLength = /* @__PURE__ */ __name(function getBitsLength() {
      return KanjiData.getBitsLength(this.data.length);
    }, "getBitsLength");
    KanjiData.prototype.write = function(bitBuffer) {
      let i2;
      for (i2 = 0; i2 < this.data.length; i2++) {
        let value = Utils.toSJIS(this.data[i2]);
        if (value >= 33088 && value <= 40956) {
          value -= 33088;
        } else if (value >= 57408 && value <= 60351) {
          value -= 49472;
        } else {
          throw new Error(
            "Invalid SJIS character: " + this.data[i2] + "\nMake sure your charset is UTF-8"
          );
        }
        value = (value >>> 8 & 255) * 192 + (value & 255);
        bitBuffer.put(value, 13);
      }
    };
    module.exports = KanjiData;
  }
});

// node_modules/dijkstrajs/dijkstra.js
var require_dijkstra = __commonJS({
  "node_modules/dijkstrajs/dijkstra.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var dijkstra = {
      single_source_shortest_paths: /* @__PURE__ */ __name(function(graph, s2, d2) {
        var predecessors = {};
        var costs = {};
        costs[s2] = 0;
        var open = dijkstra.PriorityQueue.make();
        open.push(s2, 0);
        var closest, u, v, cost_of_s_to_u, adjacent_nodes, cost_of_e, cost_of_s_to_u_plus_cost_of_e, cost_of_s_to_v, first_visit;
        while (!open.empty()) {
          closest = open.pop();
          u = closest.value;
          cost_of_s_to_u = closest.cost;
          adjacent_nodes = graph[u] || {};
          for (v in adjacent_nodes) {
            if (adjacent_nodes.hasOwnProperty(v)) {
              cost_of_e = adjacent_nodes[v];
              cost_of_s_to_u_plus_cost_of_e = cost_of_s_to_u + cost_of_e;
              cost_of_s_to_v = costs[v];
              first_visit = typeof costs[v] === "undefined";
              if (first_visit || cost_of_s_to_v > cost_of_s_to_u_plus_cost_of_e) {
                costs[v] = cost_of_s_to_u_plus_cost_of_e;
                open.push(v, cost_of_s_to_u_plus_cost_of_e);
                predecessors[v] = u;
              }
            }
          }
        }
        if (typeof d2 !== "undefined" && typeof costs[d2] === "undefined") {
          var msg = ["Could not find a path from ", s2, " to ", d2, "."].join("");
          throw new Error(msg);
        }
        return predecessors;
      }, "single_source_shortest_paths"),
      extract_shortest_path_from_predecessor_list: /* @__PURE__ */ __name(function(predecessors, d2) {
        var nodes = [];
        var u = d2;
        var predecessor;
        while (u) {
          nodes.push(u);
          predecessor = predecessors[u];
          u = predecessors[u];
        }
        nodes.reverse();
        return nodes;
      }, "extract_shortest_path_from_predecessor_list"),
      find_path: /* @__PURE__ */ __name(function(graph, s2, d2) {
        var predecessors = dijkstra.single_source_shortest_paths(graph, s2, d2);
        return dijkstra.extract_shortest_path_from_predecessor_list(
          predecessors,
          d2
        );
      }, "find_path"),
      /**
       * A very naive priority queue implementation.
       */
      PriorityQueue: {
        make: /* @__PURE__ */ __name(function(opts) {
          var T = dijkstra.PriorityQueue, t = {}, key;
          opts = opts || {};
          for (key in T) {
            if (T.hasOwnProperty(key)) {
              t[key] = T[key];
            }
          }
          t.queue = [];
          t.sorter = opts.sorter || T.default_sorter;
          return t;
        }, "make"),
        default_sorter: /* @__PURE__ */ __name(function(a2, b) {
          return a2.cost - b.cost;
        }, "default_sorter"),
        /**
         * Add a new item to the queue and ensure the highest priority element
         * is at the front of the queue.
         */
        push: /* @__PURE__ */ __name(function(value, cost) {
          var item = { value, cost };
          this.queue.push(item);
          this.queue.sort(this.sorter);
        }, "push"),
        /**
         * Return the highest priority element in the queue.
         */
        pop: /* @__PURE__ */ __name(function() {
          return this.queue.shift();
        }, "pop"),
        empty: /* @__PURE__ */ __name(function() {
          return this.queue.length === 0;
        }, "empty")
      }
    };
    if (typeof module !== "undefined") {
      module.exports = dijkstra;
    }
  }
});

// node_modules/qrcode/lib/core/segments.js
var require_segments = __commonJS({
  "node_modules/qrcode/lib/core/segments.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var Mode = require_mode();
    var NumericData = require_numeric_data();
    var AlphanumericData = require_alphanumeric_data();
    var ByteData = require_byte_data();
    var KanjiData = require_kanji_data();
    var Regex = require_regex();
    var Utils = require_utils();
    var dijkstra = require_dijkstra();
    function getStringByteLength(str) {
      return unescape(encodeURIComponent(str)).length;
    }
    __name(getStringByteLength, "getStringByteLength");
    function getSegments(regex, mode, str) {
      const segments = [];
      let result;
      while ((result = regex.exec(str)) !== null) {
        segments.push({
          data: result[0],
          index: result.index,
          mode,
          length: result[0].length
        });
      }
      return segments;
    }
    __name(getSegments, "getSegments");
    function getSegmentsFromString(dataStr) {
      const numSegs = getSegments(Regex.NUMERIC, Mode.NUMERIC, dataStr);
      const alphaNumSegs = getSegments(Regex.ALPHANUMERIC, Mode.ALPHANUMERIC, dataStr);
      let byteSegs;
      let kanjiSegs;
      if (Utils.isKanjiModeEnabled()) {
        byteSegs = getSegments(Regex.BYTE, Mode.BYTE, dataStr);
        kanjiSegs = getSegments(Regex.KANJI, Mode.KANJI, dataStr);
      } else {
        byteSegs = getSegments(Regex.BYTE_KANJI, Mode.BYTE, dataStr);
        kanjiSegs = [];
      }
      const segs = numSegs.concat(alphaNumSegs, byteSegs, kanjiSegs);
      return segs.sort(function(s1, s2) {
        return s1.index - s2.index;
      }).map(function(obj) {
        return {
          data: obj.data,
          mode: obj.mode,
          length: obj.length
        };
      });
    }
    __name(getSegmentsFromString, "getSegmentsFromString");
    function getSegmentBitsLength(length, mode) {
      switch (mode) {
        case Mode.NUMERIC:
          return NumericData.getBitsLength(length);
        case Mode.ALPHANUMERIC:
          return AlphanumericData.getBitsLength(length);
        case Mode.KANJI:
          return KanjiData.getBitsLength(length);
        case Mode.BYTE:
          return ByteData.getBitsLength(length);
      }
    }
    __name(getSegmentBitsLength, "getSegmentBitsLength");
    function mergeSegments(segs) {
      return segs.reduce(function(acc, curr) {
        const prevSeg = acc.length - 1 >= 0 ? acc[acc.length - 1] : null;
        if (prevSeg && prevSeg.mode === curr.mode) {
          acc[acc.length - 1].data += curr.data;
          return acc;
        }
        acc.push(curr);
        return acc;
      }, []);
    }
    __name(mergeSegments, "mergeSegments");
    function buildNodes(segs) {
      const nodes = [];
      for (let i2 = 0; i2 < segs.length; i2++) {
        const seg = segs[i2];
        switch (seg.mode) {
          case Mode.NUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.ALPHANUMERIC, length: seg.length },
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.ALPHANUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.KANJI:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
            break;
          case Mode.BYTE:
            nodes.push([
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
        }
      }
      return nodes;
    }
    __name(buildNodes, "buildNodes");
    function buildGraph(nodes, version3) {
      const table3 = {};
      const graph = { start: {} };
      let prevNodeIds = ["start"];
      for (let i2 = 0; i2 < nodes.length; i2++) {
        const nodeGroup = nodes[i2];
        const currentNodeIds = [];
        for (let j = 0; j < nodeGroup.length; j++) {
          const node = nodeGroup[j];
          const key = "" + i2 + j;
          currentNodeIds.push(key);
          table3[key] = { node, lastCount: 0 };
          graph[key] = {};
          for (let n2 = 0; n2 < prevNodeIds.length; n2++) {
            const prevNodeId = prevNodeIds[n2];
            if (table3[prevNodeId] && table3[prevNodeId].node.mode === node.mode) {
              graph[prevNodeId][key] = getSegmentBitsLength(table3[prevNodeId].lastCount + node.length, node.mode) - getSegmentBitsLength(table3[prevNodeId].lastCount, node.mode);
              table3[prevNodeId].lastCount += node.length;
            } else {
              if (table3[prevNodeId]) table3[prevNodeId].lastCount = node.length;
              graph[prevNodeId][key] = getSegmentBitsLength(node.length, node.mode) + 4 + Mode.getCharCountIndicator(node.mode, version3);
            }
          }
        }
        prevNodeIds = currentNodeIds;
      }
      for (let n2 = 0; n2 < prevNodeIds.length; n2++) {
        graph[prevNodeIds[n2]].end = 0;
      }
      return { map: graph, table: table3 };
    }
    __name(buildGraph, "buildGraph");
    function buildSingleSegment(data, modesHint) {
      let mode;
      const bestMode = Mode.getBestModeForData(data);
      mode = Mode.from(modesHint, bestMode);
      if (mode !== Mode.BYTE && mode.bit < bestMode.bit) {
        throw new Error('"' + data + '" cannot be encoded with mode ' + Mode.toString(mode) + ".\n Suggested mode is: " + Mode.toString(bestMode));
      }
      if (mode === Mode.KANJI && !Utils.isKanjiModeEnabled()) {
        mode = Mode.BYTE;
      }
      switch (mode) {
        case Mode.NUMERIC:
          return new NumericData(data);
        case Mode.ALPHANUMERIC:
          return new AlphanumericData(data);
        case Mode.KANJI:
          return new KanjiData(data);
        case Mode.BYTE:
          return new ByteData(data);
      }
    }
    __name(buildSingleSegment, "buildSingleSegment");
    exports.fromArray = /* @__PURE__ */ __name(function fromArray(array) {
      return array.reduce(function(acc, seg) {
        if (typeof seg === "string") {
          acc.push(buildSingleSegment(seg, null));
        } else if (seg.data) {
          acc.push(buildSingleSegment(seg.data, seg.mode));
        }
        return acc;
      }, []);
    }, "fromArray");
    exports.fromString = /* @__PURE__ */ __name(function fromString(data, version3) {
      const segs = getSegmentsFromString(data, Utils.isKanjiModeEnabled());
      const nodes = buildNodes(segs);
      const graph = buildGraph(nodes, version3);
      const path = dijkstra.find_path(graph.map, "start", "end");
      const optimizedSegs = [];
      for (let i2 = 1; i2 < path.length - 1; i2++) {
        optimizedSegs.push(graph.table[path[i2]].node);
      }
      return exports.fromArray(mergeSegments(optimizedSegs));
    }, "fromString");
    exports.rawSplit = /* @__PURE__ */ __name(function rawSplit(data) {
      return exports.fromArray(
        getSegmentsFromString(data, Utils.isKanjiModeEnabled())
      );
    }, "rawSplit");
  }
});

// node_modules/qrcode/lib/core/qrcode.js
var require_qrcode = __commonJS({
  "node_modules/qrcode/lib/core/qrcode.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var Utils = require_utils();
    var ECLevel = require_error_correction_level();
    var BitBuffer = require_bit_buffer();
    var BitMatrix = require_bit_matrix();
    var AlignmentPattern = require_alignment_pattern();
    var FinderPattern = require_finder_pattern();
    var MaskPattern = require_mask_pattern();
    var ECCode = require_error_correction_code();
    var ReedSolomonEncoder = require_reed_solomon_encoder();
    var Version = require_version();
    var FormatInfo = require_format_info();
    var Mode = require_mode();
    var Segments = require_segments();
    function setupFinderPattern(matrix, version3) {
      const size = matrix.size;
      const pos = FinderPattern.getPositions(version3);
      for (let i2 = 0; i2 < pos.length; i2++) {
        const row = pos[i2][0];
        const col = pos[i2][1];
        for (let r3 = -1; r3 <= 7; r3++) {
          if (row + r3 <= -1 || size <= row + r3) continue;
          for (let c2 = -1; c2 <= 7; c2++) {
            if (col + c2 <= -1 || size <= col + c2) continue;
            if (r3 >= 0 && r3 <= 6 && (c2 === 0 || c2 === 6) || c2 >= 0 && c2 <= 6 && (r3 === 0 || r3 === 6) || r3 >= 2 && r3 <= 4 && c2 >= 2 && c2 <= 4) {
              matrix.set(row + r3, col + c2, true, true);
            } else {
              matrix.set(row + r3, col + c2, false, true);
            }
          }
        }
      }
    }
    __name(setupFinderPattern, "setupFinderPattern");
    function setupTimingPattern(matrix) {
      const size = matrix.size;
      for (let r3 = 8; r3 < size - 8; r3++) {
        const value = r3 % 2 === 0;
        matrix.set(r3, 6, value, true);
        matrix.set(6, r3, value, true);
      }
    }
    __name(setupTimingPattern, "setupTimingPattern");
    function setupAlignmentPattern(matrix, version3) {
      const pos = AlignmentPattern.getPositions(version3);
      for (let i2 = 0; i2 < pos.length; i2++) {
        const row = pos[i2][0];
        const col = pos[i2][1];
        for (let r3 = -2; r3 <= 2; r3++) {
          for (let c2 = -2; c2 <= 2; c2++) {
            if (r3 === -2 || r3 === 2 || c2 === -2 || c2 === 2 || r3 === 0 && c2 === 0) {
              matrix.set(row + r3, col + c2, true, true);
            } else {
              matrix.set(row + r3, col + c2, false, true);
            }
          }
        }
      }
    }
    __name(setupAlignmentPattern, "setupAlignmentPattern");
    function setupVersionInfo(matrix, version3) {
      const size = matrix.size;
      const bits = Version.getEncodedBits(version3);
      let row, col, mod;
      for (let i2 = 0; i2 < 18; i2++) {
        row = Math.floor(i2 / 3);
        col = i2 % 3 + size - 8 - 3;
        mod = (bits >> i2 & 1) === 1;
        matrix.set(row, col, mod, true);
        matrix.set(col, row, mod, true);
      }
    }
    __name(setupVersionInfo, "setupVersionInfo");
    function setupFormatInfo(matrix, errorCorrectionLevel, maskPattern) {
      const size = matrix.size;
      const bits = FormatInfo.getEncodedBits(errorCorrectionLevel, maskPattern);
      let i2, mod;
      for (i2 = 0; i2 < 15; i2++) {
        mod = (bits >> i2 & 1) === 1;
        if (i2 < 6) {
          matrix.set(i2, 8, mod, true);
        } else if (i2 < 8) {
          matrix.set(i2 + 1, 8, mod, true);
        } else {
          matrix.set(size - 15 + i2, 8, mod, true);
        }
        if (i2 < 8) {
          matrix.set(8, size - i2 - 1, mod, true);
        } else if (i2 < 9) {
          matrix.set(8, 15 - i2 - 1 + 1, mod, true);
        } else {
          matrix.set(8, 15 - i2 - 1, mod, true);
        }
      }
      matrix.set(size - 8, 8, 1, true);
    }
    __name(setupFormatInfo, "setupFormatInfo");
    function setupData(matrix, data) {
      const size = matrix.size;
      let inc = -1;
      let row = size - 1;
      let bitIndex = 7;
      let byteIndex = 0;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c2 = 0; c2 < 2; c2++) {
            if (!matrix.isReserved(row, col - c2)) {
              let dark = false;
              if (byteIndex < data.length) {
                dark = (data[byteIndex] >>> bitIndex & 1) === 1;
              }
              matrix.set(row, col - c2, dark);
              bitIndex--;
              if (bitIndex === -1) {
                byteIndex++;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || size <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    }
    __name(setupData, "setupData");
    function createData(version3, errorCorrectionLevel, segments) {
      const buffer = new BitBuffer();
      segments.forEach(function(data) {
        buffer.put(data.mode.bit, 4);
        buffer.put(data.getLength(), Mode.getCharCountIndicator(data.mode, version3));
        data.write(buffer);
      });
      const totalCodewords = Utils.getSymbolTotalCodewords(version3);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version3, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (buffer.getLengthInBits() + 4 <= dataTotalCodewordsBits) {
        buffer.put(0, 4);
      }
      while (buffer.getLengthInBits() % 8 !== 0) {
        buffer.putBit(0);
      }
      const remainingByte = (dataTotalCodewordsBits - buffer.getLengthInBits()) / 8;
      for (let i2 = 0; i2 < remainingByte; i2++) {
        buffer.put(i2 % 2 ? 17 : 236, 8);
      }
      return createCodewords(buffer, version3, errorCorrectionLevel);
    }
    __name(createData, "createData");
    function createCodewords(bitBuffer, version3, errorCorrectionLevel) {
      const totalCodewords = Utils.getSymbolTotalCodewords(version3);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version3, errorCorrectionLevel);
      const dataTotalCodewords = totalCodewords - ecTotalCodewords;
      const ecTotalBlocks = ECCode.getBlocksCount(version3, errorCorrectionLevel);
      const blocksInGroup2 = totalCodewords % ecTotalBlocks;
      const blocksInGroup1 = ecTotalBlocks - blocksInGroup2;
      const totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1;
      const ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1;
      const rs = new ReedSolomonEncoder(ecCount);
      let offset = 0;
      const dcData = new Array(ecTotalBlocks);
      const ecData = new Array(ecTotalBlocks);
      let maxDataSize = 0;
      const buffer = new Uint8Array(bitBuffer.buffer);
      for (let b = 0; b < ecTotalBlocks; b++) {
        const dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2;
        dcData[b] = buffer.slice(offset, offset + dataSize);
        ecData[b] = rs.encode(dcData[b]);
        offset += dataSize;
        maxDataSize = Math.max(maxDataSize, dataSize);
      }
      const data = new Uint8Array(totalCodewords);
      let index = 0;
      let i2, r3;
      for (i2 = 0; i2 < maxDataSize; i2++) {
        for (r3 = 0; r3 < ecTotalBlocks; r3++) {
          if (i2 < dcData[r3].length) {
            data[index++] = dcData[r3][i2];
          }
        }
      }
      for (i2 = 0; i2 < ecCount; i2++) {
        for (r3 = 0; r3 < ecTotalBlocks; r3++) {
          data[index++] = ecData[r3][i2];
        }
      }
      return data;
    }
    __name(createCodewords, "createCodewords");
    function createSymbol(data, version3, errorCorrectionLevel, maskPattern) {
      let segments;
      if (Array.isArray(data)) {
        segments = Segments.fromArray(data);
      } else if (typeof data === "string") {
        let estimatedVersion = version3;
        if (!estimatedVersion) {
          const rawSegments = Segments.rawSplit(data);
          estimatedVersion = Version.getBestVersionForData(rawSegments, errorCorrectionLevel);
        }
        segments = Segments.fromString(data, estimatedVersion || 40);
      } else {
        throw new Error("Invalid data");
      }
      const bestVersion = Version.getBestVersionForData(segments, errorCorrectionLevel);
      if (!bestVersion) {
        throw new Error("The amount of data is too big to be stored in a QR Code");
      }
      if (!version3) {
        version3 = bestVersion;
      } else if (version3 < bestVersion) {
        throw new Error(
          "\nThe chosen QR Code version cannot contain this amount of data.\nMinimum version required to store current data is: " + bestVersion + ".\n"
        );
      }
      const dataBits = createData(version3, errorCorrectionLevel, segments);
      const moduleCount = Utils.getSymbolSize(version3);
      const modules = new BitMatrix(moduleCount);
      setupFinderPattern(modules, version3);
      setupTimingPattern(modules);
      setupAlignmentPattern(modules, version3);
      setupFormatInfo(modules, errorCorrectionLevel, 0);
      if (version3 >= 7) {
        setupVersionInfo(modules, version3);
      }
      setupData(modules, dataBits);
      if (isNaN(maskPattern)) {
        maskPattern = MaskPattern.getBestMask(
          modules,
          setupFormatInfo.bind(null, modules, errorCorrectionLevel)
        );
      }
      MaskPattern.applyMask(maskPattern, modules);
      setupFormatInfo(modules, errorCorrectionLevel, maskPattern);
      return {
        modules,
        version: version3,
        errorCorrectionLevel,
        maskPattern,
        segments
      };
    }
    __name(createSymbol, "createSymbol");
    exports.create = /* @__PURE__ */ __name(function create(data, options) {
      if (typeof data === "undefined" || data === "") {
        throw new Error("No input text");
      }
      let errorCorrectionLevel = ECLevel.M;
      let version3;
      let mask;
      if (typeof options !== "undefined") {
        errorCorrectionLevel = ECLevel.from(options.errorCorrectionLevel, ECLevel.M);
        version3 = Version.from(options.version);
        mask = MaskPattern.from(options.maskPattern);
        if (options.toSJISFunc) {
          Utils.setToSJISFunction(options.toSJISFunc);
        }
      }
      return createSymbol(data, version3, errorCorrectionLevel, mask);
    }, "create");
  }
});

// node_modules/qrcode/lib/renderer/utils.js
var require_utils2 = __commonJS({
  "node_modules/qrcode/lib/renderer/utils.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    function hex2rgba(hex) {
      if (typeof hex === "number") {
        hex = hex.toString();
      }
      if (typeof hex !== "string") {
        throw new Error("Color should be defined as hex string");
      }
      let hexCode = hex.slice().replace("#", "").split("");
      if (hexCode.length < 3 || hexCode.length === 5 || hexCode.length > 8) {
        throw new Error("Invalid hex color: " + hex);
      }
      if (hexCode.length === 3 || hexCode.length === 4) {
        hexCode = Array.prototype.concat.apply([], hexCode.map(function(c2) {
          return [c2, c2];
        }));
      }
      if (hexCode.length === 6) hexCode.push("F", "F");
      const hexValue = parseInt(hexCode.join(""), 16);
      return {
        r: hexValue >> 24 & 255,
        g: hexValue >> 16 & 255,
        b: hexValue >> 8 & 255,
        a: hexValue & 255,
        hex: "#" + hexCode.slice(0, 6).join("")
      };
    }
    __name(hex2rgba, "hex2rgba");
    exports.getOptions = /* @__PURE__ */ __name(function getOptions(options) {
      if (!options) options = {};
      if (!options.color) options.color = {};
      const margin = typeof options.margin === "undefined" || options.margin === null || options.margin < 0 ? 4 : options.margin;
      const width = options.width && options.width >= 21 ? options.width : void 0;
      const scale = options.scale || 4;
      return {
        width,
        scale: width ? 4 : scale,
        margin,
        color: {
          dark: hex2rgba(options.color.dark || "#000000ff"),
          light: hex2rgba(options.color.light || "#ffffffff")
        },
        type: options.type,
        rendererOpts: options.rendererOpts || {}
      };
    }, "getOptions");
    exports.getScale = /* @__PURE__ */ __name(function getScale(qrSize, opts) {
      return opts.width && opts.width >= qrSize + opts.margin * 2 ? opts.width / (qrSize + opts.margin * 2) : opts.scale;
    }, "getScale");
    exports.getImageWidth = /* @__PURE__ */ __name(function getImageWidth(qrSize, opts) {
      const scale = exports.getScale(qrSize, opts);
      return Math.floor((qrSize + opts.margin * 2) * scale);
    }, "getImageWidth");
    exports.qrToImageData = /* @__PURE__ */ __name(function qrToImageData(imgData, qr, opts) {
      const size = qr.modules.size;
      const data = qr.modules.data;
      const scale = exports.getScale(size, opts);
      const symbolSize = Math.floor((size + opts.margin * 2) * scale);
      const scaledMargin = opts.margin * scale;
      const palette = [opts.color.light, opts.color.dark];
      for (let i2 = 0; i2 < symbolSize; i2++) {
        for (let j = 0; j < symbolSize; j++) {
          let posDst = (i2 * symbolSize + j) * 4;
          let pxColor = opts.color.light;
          if (i2 >= scaledMargin && j >= scaledMargin && i2 < symbolSize - scaledMargin && j < symbolSize - scaledMargin) {
            const iSrc = Math.floor((i2 - scaledMargin) / scale);
            const jSrc = Math.floor((j - scaledMargin) / scale);
            pxColor = palette[data[iSrc * size + jSrc] ? 1 : 0];
          }
          imgData[posDst++] = pxColor.r;
          imgData[posDst++] = pxColor.g;
          imgData[posDst++] = pxColor.b;
          imgData[posDst] = pxColor.a;
        }
      }
    }, "qrToImageData");
  }
});

// node_modules/qrcode/lib/renderer/canvas.js
var require_canvas = __commonJS({
  "node_modules/qrcode/lib/renderer/canvas.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var Utils = require_utils2();
    function clearCanvas(ctx, canvas, size) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!canvas.style) canvas.style = {};
      canvas.height = size;
      canvas.width = size;
      canvas.style.height = size + "px";
      canvas.style.width = size + "px";
    }
    __name(clearCanvas, "clearCanvas");
    function getCanvasElement() {
      try {
        return document.createElement("canvas");
      } catch (e) {
        throw new Error("You need to specify a canvas element");
      }
    }
    __name(getCanvasElement, "getCanvasElement");
    exports.render = /* @__PURE__ */ __name(function render(qrData, canvas, options) {
      let opts = options;
      let canvasEl = canvas;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!canvas) {
        canvasEl = getCanvasElement();
      }
      opts = Utils.getOptions(opts);
      const size = Utils.getImageWidth(qrData.modules.size, opts);
      const ctx = canvasEl.getContext("2d");
      const image = ctx.createImageData(size, size);
      Utils.qrToImageData(image.data, qrData, opts);
      clearCanvas(ctx, canvasEl, size);
      ctx.putImageData(image, 0, 0);
      return canvasEl;
    }, "render");
    exports.renderToDataURL = /* @__PURE__ */ __name(function renderToDataURL(qrData, canvas, options) {
      let opts = options;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!opts) opts = {};
      const canvasEl = exports.render(qrData, canvas, opts);
      const type = opts.type || "image/png";
      const rendererOpts = opts.rendererOpts || {};
      return canvasEl.toDataURL(type, rendererOpts.quality);
    }, "renderToDataURL");
  }
});

// node_modules/qrcode/lib/renderer/svg-tag.js
var require_svg_tag = __commonJS({
  "node_modules/qrcode/lib/renderer/svg-tag.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var Utils = require_utils2();
    function getColorAttrib(color, attrib) {
      const alpha = color.a / 255;
      const str = attrib + '="' + color.hex + '"';
      return alpha < 1 ? str + " " + attrib + '-opacity="' + alpha.toFixed(2).slice(1) + '"' : str;
    }
    __name(getColorAttrib, "getColorAttrib");
    function svgCmd(cmd, x, y) {
      let str = cmd + x;
      if (typeof y !== "undefined") str += " " + y;
      return str;
    }
    __name(svgCmd, "svgCmd");
    function qrToPath(data, size, margin) {
      let path = "";
      let moveBy = 0;
      let newRow = false;
      let lineLength = 0;
      for (let i2 = 0; i2 < data.length; i2++) {
        const col = Math.floor(i2 % size);
        const row = Math.floor(i2 / size);
        if (!col && !newRow) newRow = true;
        if (data[i2]) {
          lineLength++;
          if (!(i2 > 0 && col > 0 && data[i2 - 1])) {
            path += newRow ? svgCmd("M", col + margin, 0.5 + row + margin) : svgCmd("m", moveBy, 0);
            moveBy = 0;
            newRow = false;
          }
          if (!(col + 1 < size && data[i2 + 1])) {
            path += svgCmd("h", lineLength);
            lineLength = 0;
          }
        } else {
          moveBy++;
        }
      }
      return path;
    }
    __name(qrToPath, "qrToPath");
    exports.render = /* @__PURE__ */ __name(function render(qrData, options, cb) {
      const opts = Utils.getOptions(options);
      const size = qrData.modules.size;
      const data = qrData.modules.data;
      const qrcodesize = size + opts.margin * 2;
      const bg = !opts.color.light.a ? "" : "<path " + getColorAttrib(opts.color.light, "fill") + ' d="M0 0h' + qrcodesize + "v" + qrcodesize + 'H0z"/>';
      const path = "<path " + getColorAttrib(opts.color.dark, "stroke") + ' d="' + qrToPath(data, size, opts.margin) + '"/>';
      const viewBox = 'viewBox="0 0 ' + qrcodesize + " " + qrcodesize + '"';
      const width = !opts.width ? "" : 'width="' + opts.width + '" height="' + opts.width + '" ';
      const svgTag = '<svg xmlns="http://www.w3.org/2000/svg" ' + width + viewBox + ' shape-rendering="crispEdges">' + bg + path + "</svg>\n";
      if (typeof cb === "function") {
        cb(null, svgTag);
      }
      return svgTag;
    }, "render");
  }
});

// node_modules/qrcode/lib/browser.js
var require_browser = __commonJS({
  "node_modules/qrcode/lib/browser.js"(exports) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var canPromise = require_can_promise();
    var QRCode2 = require_qrcode();
    var CanvasRenderer = require_canvas();
    var SvgRenderer = require_svg_tag();
    function renderCanvas(renderFunc, canvas, text, opts, cb) {
      const args = [].slice.call(arguments, 1);
      const argsNum = args.length;
      const isLastArgCb = typeof args[argsNum - 1] === "function";
      if (!isLastArgCb && !canPromise()) {
        throw new Error("Callback required as last argument");
      }
      if (isLastArgCb) {
        if (argsNum < 2) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 2) {
          cb = text;
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 3) {
          if (canvas.getContext && typeof cb === "undefined") {
            cb = opts;
            opts = void 0;
          } else {
            cb = opts;
            opts = text;
            text = canvas;
            canvas = void 0;
          }
        }
      } else {
        if (argsNum < 1) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 1) {
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 2 && !canvas.getContext) {
          opts = text;
          text = canvas;
          canvas = void 0;
        }
        return new Promise(function(resolve, reject) {
          try {
            const data = QRCode2.create(text, opts);
            resolve(renderFunc(data, canvas, opts));
          } catch (e) {
            reject(e);
          }
        });
      }
      try {
        const data = QRCode2.create(text, opts);
        cb(null, renderFunc(data, canvas, opts));
      } catch (e) {
        cb(e);
      }
    }
    __name(renderCanvas, "renderCanvas");
    exports.create = QRCode2.create;
    exports.toCanvas = renderCanvas.bind(null, CanvasRenderer.render);
    exports.toDataURL = renderCanvas.bind(null, CanvasRenderer.renderToDataURL);
    exports.toString = renderCanvas.bind(null, function(data, _, opts) {
      return SvgRenderer.render(data, opts);
    });
  }
});

// node_modules/core-js-pure/internals/global-this.js
var require_global_this = __commonJS({
  "node_modules/core-js-pure/internals/global-this.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var check = /* @__PURE__ */ __name(function(it) {
      return it && it.Math === Math && it;
    }, "check");
    module.exports = // eslint-disable-next-line es/no-global-this -- safe
    check(typeof globalThis == "object" && globalThis) || check(typeof window == "object" && window) || // eslint-disable-next-line no-restricted-globals -- safe
    check(typeof self == "object" && self) || check(typeof global == "object" && global) || check(typeof exports == "object" && exports) || // eslint-disable-next-line no-new-func -- fallback
    /* @__PURE__ */ (function() {
      return this;
    })() || Function("return this")();
  }
});

// node_modules/core-js-pure/internals/fails.js
var require_fails = __commonJS({
  "node_modules/core-js-pure/internals/fails.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = function(exec) {
      try {
        return !!exec();
      } catch (error3) {
        return true;
      }
    };
  }
});

// node_modules/core-js-pure/internals/function-bind-native.js
var require_function_bind_native = __commonJS({
  "node_modules/core-js-pure/internals/function-bind-native.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var fails = require_fails();
    module.exports = !fails(function() {
      var test = function() {
      }.bind();
      return typeof test != "function" || test.hasOwnProperty("prototype");
    });
  }
});

// node_modules/core-js-pure/internals/function-apply.js
var require_function_apply = __commonJS({
  "node_modules/core-js-pure/internals/function-apply.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var NATIVE_BIND = require_function_bind_native();
    var FunctionPrototype = Function.prototype;
    var apply = FunctionPrototype.apply;
    var call = FunctionPrototype.call;
    module.exports = typeof Reflect == "object" && Reflect.apply || (NATIVE_BIND ? call.bind(apply) : function() {
      return call.apply(apply, arguments);
    });
  }
});

// node_modules/core-js-pure/internals/function-uncurry-this.js
var require_function_uncurry_this = __commonJS({
  "node_modules/core-js-pure/internals/function-uncurry-this.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var NATIVE_BIND = require_function_bind_native();
    var FunctionPrototype = Function.prototype;
    var call = FunctionPrototype.call;
    var uncurryThisWithBind = NATIVE_BIND && FunctionPrototype.bind.bind(call, call);
    module.exports = NATIVE_BIND ? uncurryThisWithBind : function(fn) {
      return function() {
        return call.apply(fn, arguments);
      };
    };
  }
});

// node_modules/core-js-pure/internals/classof-raw.js
var require_classof_raw = __commonJS({
  "node_modules/core-js-pure/internals/classof-raw.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this();
    var toString = uncurryThis({}.toString);
    var stringSlice = uncurryThis("".slice);
    module.exports = function(it) {
      return stringSlice(toString(it), 8, -1);
    };
  }
});

// node_modules/core-js-pure/internals/function-uncurry-this-clause.js
var require_function_uncurry_this_clause = __commonJS({
  "node_modules/core-js-pure/internals/function-uncurry-this-clause.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var classofRaw = require_classof_raw();
    var uncurryThis = require_function_uncurry_this();
    module.exports = function(fn) {
      if (classofRaw(fn) === "Function") return uncurryThis(fn);
    };
  }
});

// node_modules/core-js-pure/internals/is-callable.js
var require_is_callable = __commonJS({
  "node_modules/core-js-pure/internals/is-callable.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var documentAll = typeof document == "object" && document.all;
    module.exports = typeof documentAll == "undefined" && documentAll !== void 0 ? function(argument) {
      return typeof argument == "function" || argument === documentAll;
    } : function(argument) {
      return typeof argument == "function";
    };
  }
});

// node_modules/core-js-pure/internals/descriptors.js
var require_descriptors = __commonJS({
  "node_modules/core-js-pure/internals/descriptors.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var fails = require_fails();
    module.exports = !fails(function() {
      return Object.defineProperty({}, 1, { get: /* @__PURE__ */ __name(function() {
        return 7;
      }, "get") })[1] !== 7;
    });
  }
});

// node_modules/core-js-pure/internals/function-call.js
var require_function_call = __commonJS({
  "node_modules/core-js-pure/internals/function-call.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var NATIVE_BIND = require_function_bind_native();
    var call = Function.prototype.call;
    module.exports = NATIVE_BIND ? call.bind(call) : function() {
      return call.apply(call, arguments);
    };
  }
});

// node_modules/core-js-pure/internals/object-property-is-enumerable.js
var require_object_property_is_enumerable = __commonJS({
  "node_modules/core-js-pure/internals/object-property-is-enumerable.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $propertyIsEnumerable = {}.propertyIsEnumerable;
    var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    var NASHORN_BUG = getOwnPropertyDescriptor && !$propertyIsEnumerable.call({ 1: 2 }, 1);
    exports.f = NASHORN_BUG ? /* @__PURE__ */ __name(function propertyIsEnumerable(V) {
      var descriptor = getOwnPropertyDescriptor(this, V);
      return !!descriptor && descriptor.enumerable;
    }, "propertyIsEnumerable") : $propertyIsEnumerable;
  }
});

// node_modules/core-js-pure/internals/create-property-descriptor.js
var require_create_property_descriptor = __commonJS({
  "node_modules/core-js-pure/internals/create-property-descriptor.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = function(bitmap, value) {
      return {
        enumerable: !(bitmap & 1),
        configurable: !(bitmap & 2),
        writable: !(bitmap & 4),
        value
      };
    };
  }
});

// node_modules/core-js-pure/internals/indexed-object.js
var require_indexed_object = __commonJS({
  "node_modules/core-js-pure/internals/indexed-object.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this();
    var fails = require_fails();
    var classof = require_classof_raw();
    var $Object = Object;
    var split2 = uncurryThis("".split);
    module.exports = fails(function() {
      return !$Object("z").propertyIsEnumerable(0);
    }) ? function(it) {
      return classof(it) === "String" ? split2(it, "") : $Object(it);
    } : $Object;
  }
});

// node_modules/core-js-pure/internals/is-null-or-undefined.js
var require_is_null_or_undefined = __commonJS({
  "node_modules/core-js-pure/internals/is-null-or-undefined.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = function(it) {
      return it === null || it === void 0;
    };
  }
});

// node_modules/core-js-pure/internals/require-object-coercible.js
var require_require_object_coercible = __commonJS({
  "node_modules/core-js-pure/internals/require-object-coercible.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var isNullOrUndefined = require_is_null_or_undefined();
    var $TypeError = TypeError;
    module.exports = function(it) {
      if (isNullOrUndefined(it)) throw new $TypeError("Can't call method on " + it);
      return it;
    };
  }
});

// node_modules/core-js-pure/internals/to-indexed-object.js
var require_to_indexed_object = __commonJS({
  "node_modules/core-js-pure/internals/to-indexed-object.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var IndexedObject = require_indexed_object();
    var requireObjectCoercible = require_require_object_coercible();
    module.exports = function(it) {
      return IndexedObject(requireObjectCoercible(it));
    };
  }
});

// node_modules/core-js-pure/internals/is-object.js
var require_is_object = __commonJS({
  "node_modules/core-js-pure/internals/is-object.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var isCallable = require_is_callable();
    module.exports = function(it) {
      return typeof it == "object" ? it !== null : isCallable(it);
    };
  }
});

// node_modules/core-js-pure/internals/path.js
var require_path = __commonJS({
  "node_modules/core-js-pure/internals/path.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = {};
  }
});

// node_modules/core-js-pure/internals/get-built-in.js
var require_get_built_in = __commonJS({
  "node_modules/core-js-pure/internals/get-built-in.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var path = require_path();
    var globalThis2 = require_global_this();
    var isCallable = require_is_callable();
    var aFunction = /* @__PURE__ */ __name(function(variable) {
      return isCallable(variable) ? variable : void 0;
    }, "aFunction");
    module.exports = function(namespace, method) {
      return arguments.length < 2 ? aFunction(path[namespace]) || aFunction(globalThis2[namespace]) : path[namespace] && path[namespace][method] || globalThis2[namespace] && globalThis2[namespace][method];
    };
  }
});

// node_modules/core-js-pure/internals/object-is-prototype-of.js
var require_object_is_prototype_of = __commonJS({
  "node_modules/core-js-pure/internals/object-is-prototype-of.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this();
    module.exports = uncurryThis({}.isPrototypeOf);
  }
});

// node_modules/core-js-pure/internals/environment-user-agent.js
var require_environment_user_agent = __commonJS({
  "node_modules/core-js-pure/internals/environment-user-agent.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var globalThis2 = require_global_this();
    var navigator = globalThis2.navigator;
    var userAgent = navigator && navigator.userAgent;
    module.exports = userAgent ? String(userAgent) : "";
  }
});

// node_modules/core-js-pure/internals/environment-v8-version.js
var require_environment_v8_version = __commonJS({
  "node_modules/core-js-pure/internals/environment-v8-version.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var globalThis2 = require_global_this();
    var userAgent = require_environment_user_agent();
    var process = globalThis2.process;
    var Deno = globalThis2.Deno;
    var versions2 = process && process.versions || Deno && Deno.version;
    var v8 = versions2 && versions2.v8;
    var match2;
    var version3;
    if (v8) {
      match2 = v8.split(".");
      version3 = match2[0] > 0 && match2[0] < 4 ? 1 : +(match2[0] + match2[1]);
    }
    if (!version3 && userAgent) {
      match2 = userAgent.match(/Edge\/(\d+)/);
      if (!match2 || match2[1] >= 74) {
        match2 = userAgent.match(/Chrome\/(\d+)/);
        if (match2) version3 = +match2[1];
      }
    }
    module.exports = version3;
  }
});

// node_modules/core-js-pure/internals/symbol-constructor-detection.js
var require_symbol_constructor_detection = __commonJS({
  "node_modules/core-js-pure/internals/symbol-constructor-detection.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var V8_VERSION = require_environment_v8_version();
    var fails = require_fails();
    var globalThis2 = require_global_this();
    var $String = globalThis2.String;
    module.exports = !!Object.getOwnPropertySymbols && !fails(function() {
      var symbol = /* @__PURE__ */ Symbol("symbol detection");
      return !$String(symbol) || !(Object(symbol) instanceof Symbol) || // Chrome 38-40 symbols are not inherited from DOM collections prototypes to instances
      !Symbol.sham && V8_VERSION && V8_VERSION < 41;
    });
  }
});

// node_modules/core-js-pure/internals/use-symbol-as-uid.js
var require_use_symbol_as_uid = __commonJS({
  "node_modules/core-js-pure/internals/use-symbol-as-uid.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var NATIVE_SYMBOL = require_symbol_constructor_detection();
    module.exports = NATIVE_SYMBOL && !Symbol.sham && typeof Symbol.iterator == "symbol";
  }
});

// node_modules/core-js-pure/internals/is-symbol.js
var require_is_symbol = __commonJS({
  "node_modules/core-js-pure/internals/is-symbol.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var getBuiltIn = require_get_built_in();
    var isCallable = require_is_callable();
    var isPrototypeOf = require_object_is_prototype_of();
    var USE_SYMBOL_AS_UID = require_use_symbol_as_uid();
    var $Object = Object;
    module.exports = USE_SYMBOL_AS_UID ? function(it) {
      return typeof it == "symbol";
    } : function(it) {
      var $Symbol = getBuiltIn("Symbol");
      return isCallable($Symbol) && isPrototypeOf($Symbol.prototype, $Object(it));
    };
  }
});

// node_modules/core-js-pure/internals/try-to-string.js
var require_try_to_string = __commonJS({
  "node_modules/core-js-pure/internals/try-to-string.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $String = String;
    module.exports = function(argument) {
      try {
        return $String(argument);
      } catch (error3) {
        return "Object";
      }
    };
  }
});

// node_modules/core-js-pure/internals/a-callable.js
var require_a_callable = __commonJS({
  "node_modules/core-js-pure/internals/a-callable.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var isCallable = require_is_callable();
    var tryToString = require_try_to_string();
    var $TypeError = TypeError;
    module.exports = function(argument) {
      if (isCallable(argument)) return argument;
      throw new $TypeError(tryToString(argument) + " is not a function");
    };
  }
});

// node_modules/core-js-pure/internals/get-method.js
var require_get_method = __commonJS({
  "node_modules/core-js-pure/internals/get-method.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var aCallable = require_a_callable();
    var isNullOrUndefined = require_is_null_or_undefined();
    module.exports = function(V, P) {
      var func = V[P];
      return isNullOrUndefined(func) ? void 0 : aCallable(func);
    };
  }
});

// node_modules/core-js-pure/internals/ordinary-to-primitive.js
var require_ordinary_to_primitive = __commonJS({
  "node_modules/core-js-pure/internals/ordinary-to-primitive.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var call = require_function_call();
    var isCallable = require_is_callable();
    var isObject2 = require_is_object();
    var $TypeError = TypeError;
    module.exports = function(input, pref) {
      var fn, val;
      if (pref === "string" && isCallable(fn = input.toString) && !isObject2(val = call(fn, input))) return val;
      if (isCallable(fn = input.valueOf) && !isObject2(val = call(fn, input))) return val;
      if (pref !== "string" && isCallable(fn = input.toString) && !isObject2(val = call(fn, input))) return val;
      throw new $TypeError("Can't convert object to primitive value");
    };
  }
});

// node_modules/core-js-pure/internals/is-pure.js
var require_is_pure = __commonJS({
  "node_modules/core-js-pure/internals/is-pure.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = true;
  }
});

// node_modules/core-js-pure/internals/define-global-property.js
var require_define_global_property = __commonJS({
  "node_modules/core-js-pure/internals/define-global-property.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var globalThis2 = require_global_this();
    var defineProperty = Object.defineProperty;
    module.exports = function(key, value) {
      try {
        defineProperty(globalThis2, key, { value, configurable: true, writable: true });
      } catch (error3) {
        globalThis2[key] = value;
      }
      return value;
    };
  }
});

// node_modules/core-js-pure/internals/shared-store.js
var require_shared_store = __commonJS({
  "node_modules/core-js-pure/internals/shared-store.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var IS_PURE = require_is_pure();
    var globalThis2 = require_global_this();
    var defineGlobalProperty = require_define_global_property();
    var SHARED = "__core-js_shared__";
    var store = module.exports = globalThis2[SHARED] || defineGlobalProperty(SHARED, {});
    (store.versions || (store.versions = [])).push({
      version: "3.49.0",
      mode: IS_PURE ? "pure" : "global",
      copyright: "\xA9 2013\u20132025 Denis Pushkarev (zloirock.ru), 2025\u20132026 CoreJS Company (core-js.io). All rights reserved.",
      license: "https://github.com/zloirock/core-js/blob/v3.49.0/LICENSE",
      source: "https://github.com/zloirock/core-js"
    });
  }
});

// node_modules/core-js-pure/internals/shared.js
var require_shared = __commonJS({
  "node_modules/core-js-pure/internals/shared.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var store = require_shared_store();
    module.exports = function(key, value) {
      return store[key] || (store[key] = value || {});
    };
  }
});

// node_modules/core-js-pure/internals/to-object.js
var require_to_object = __commonJS({
  "node_modules/core-js-pure/internals/to-object.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var requireObjectCoercible = require_require_object_coercible();
    var $Object = Object;
    module.exports = function(argument) {
      return $Object(requireObjectCoercible(argument));
    };
  }
});

// node_modules/core-js-pure/internals/has-own-property.js
var require_has_own_property = __commonJS({
  "node_modules/core-js-pure/internals/has-own-property.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this();
    var toObject = require_to_object();
    var hasOwnProperty = uncurryThis({}.hasOwnProperty);
    module.exports = Object.hasOwn || /* @__PURE__ */ __name(function hasOwn(it, key) {
      return hasOwnProperty(toObject(it), key);
    }, "hasOwn");
  }
});

// node_modules/core-js-pure/internals/uid.js
var require_uid = __commonJS({
  "node_modules/core-js-pure/internals/uid.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this();
    var id = 0;
    var postfix = Math.random();
    var toString = uncurryThis(1.1.toString);
    module.exports = function(key) {
      return "Symbol(" + (key === void 0 ? "" : key) + ")_" + toString(++id + postfix, 36);
    };
  }
});

// node_modules/core-js-pure/internals/well-known-symbol.js
var require_well_known_symbol = __commonJS({
  "node_modules/core-js-pure/internals/well-known-symbol.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var globalThis2 = require_global_this();
    var shared = require_shared();
    var hasOwn = require_has_own_property();
    var uid = require_uid();
    var NATIVE_SYMBOL = require_symbol_constructor_detection();
    var USE_SYMBOL_AS_UID = require_use_symbol_as_uid();
    var Symbol2 = globalThis2.Symbol;
    var WellKnownSymbolsStore = shared("wks");
    var createWellKnownSymbol = USE_SYMBOL_AS_UID ? Symbol2["for"] || Symbol2 : Symbol2 && Symbol2.withoutSetter || uid;
    module.exports = function(name) {
      if (!hasOwn(WellKnownSymbolsStore, name)) {
        WellKnownSymbolsStore[name] = NATIVE_SYMBOL && hasOwn(Symbol2, name) ? Symbol2[name] : createWellKnownSymbol("Symbol." + name);
      }
      return WellKnownSymbolsStore[name];
    };
  }
});

// node_modules/core-js-pure/internals/to-primitive.js
var require_to_primitive = __commonJS({
  "node_modules/core-js-pure/internals/to-primitive.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var call = require_function_call();
    var isObject2 = require_is_object();
    var isSymbol = require_is_symbol();
    var getMethod = require_get_method();
    var ordinaryToPrimitive = require_ordinary_to_primitive();
    var wellKnownSymbol = require_well_known_symbol();
    var $TypeError = TypeError;
    var TO_PRIMITIVE = wellKnownSymbol("toPrimitive");
    module.exports = function(input, pref) {
      if (!isObject2(input) || isSymbol(input)) return input;
      var exoticToPrim = getMethod(input, TO_PRIMITIVE);
      var result;
      if (exoticToPrim) {
        if (pref === void 0) pref = "default";
        result = call(exoticToPrim, input, pref);
        if (!isObject2(result) || isSymbol(result)) return result;
        throw new $TypeError("Can't convert object to primitive value");
      }
      if (pref === void 0) pref = "number";
      return ordinaryToPrimitive(input, pref);
    };
  }
});

// node_modules/core-js-pure/internals/to-property-key.js
var require_to_property_key = __commonJS({
  "node_modules/core-js-pure/internals/to-property-key.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var toPrimitive2 = require_to_primitive();
    var isSymbol = require_is_symbol();
    module.exports = function(argument) {
      var key = toPrimitive2(argument, "string");
      return isSymbol(key) ? key : key + "";
    };
  }
});

// node_modules/core-js-pure/internals/document-create-element.js
var require_document_create_element = __commonJS({
  "node_modules/core-js-pure/internals/document-create-element.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var globalThis2 = require_global_this();
    var isObject2 = require_is_object();
    var document2 = globalThis2.document;
    var EXISTS = isObject2(document2) && isObject2(document2.createElement);
    module.exports = function(it) {
      return EXISTS ? document2.createElement(it) : {};
    };
  }
});

// node_modules/core-js-pure/internals/ie8-dom-define.js
var require_ie8_dom_define = __commonJS({
  "node_modules/core-js-pure/internals/ie8-dom-define.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var DESCRIPTORS = require_descriptors();
    var fails = require_fails();
    var createElement = require_document_create_element();
    module.exports = !DESCRIPTORS && !fails(function() {
      return Object.defineProperty(createElement("div"), "a", {
        get: /* @__PURE__ */ __name(function() {
          return 7;
        }, "get")
      }).a !== 7;
    });
  }
});

// node_modules/core-js-pure/internals/object-get-own-property-descriptor.js
var require_object_get_own_property_descriptor = __commonJS({
  "node_modules/core-js-pure/internals/object-get-own-property-descriptor.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var DESCRIPTORS = require_descriptors();
    var call = require_function_call();
    var propertyIsEnumerableModule = require_object_property_is_enumerable();
    var createPropertyDescriptor = require_create_property_descriptor();
    var toIndexedObject = require_to_indexed_object();
    var toPropertyKey2 = require_to_property_key();
    var hasOwn = require_has_own_property();
    var IE8_DOM_DEFINE = require_ie8_dom_define();
    var $getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    exports.f = DESCRIPTORS ? $getOwnPropertyDescriptor : /* @__PURE__ */ __name(function getOwnPropertyDescriptor(O, P) {
      O = toIndexedObject(O);
      P = toPropertyKey2(P);
      if (IE8_DOM_DEFINE) try {
        return $getOwnPropertyDescriptor(O, P);
      } catch (error3) {
      }
      if (hasOwn(O, P)) return createPropertyDescriptor(!call(propertyIsEnumerableModule.f, O, P), O[P]);
    }, "getOwnPropertyDescriptor");
  }
});

// node_modules/core-js-pure/internals/is-forced.js
var require_is_forced = __commonJS({
  "node_modules/core-js-pure/internals/is-forced.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var fails = require_fails();
    var isCallable = require_is_callable();
    var replacement = /#|\.prototype\./;
    var isForced = /* @__PURE__ */ __name(function(feature, detection) {
      var value = data[normalize(feature)];
      return value === POLYFILL ? true : value === NATIVE ? false : isCallable(detection) ? fails(detection) : !!detection;
    }, "isForced");
    var normalize = isForced.normalize = function(string) {
      return String(string).replace(replacement, ".").toLowerCase();
    };
    var data = isForced.data = {};
    var NATIVE = isForced.NATIVE = "N";
    var POLYFILL = isForced.POLYFILL = "P";
    module.exports = isForced;
  }
});

// node_modules/core-js-pure/internals/function-bind-context.js
var require_function_bind_context = __commonJS({
  "node_modules/core-js-pure/internals/function-bind-context.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this_clause();
    var aCallable = require_a_callable();
    var NATIVE_BIND = require_function_bind_native();
    var bind = uncurryThis(uncurryThis.bind);
    module.exports = function(fn, that) {
      aCallable(fn);
      return that === void 0 ? fn : NATIVE_BIND ? bind(fn, that) : function() {
        return fn.apply(that, arguments);
      };
    };
  }
});

// node_modules/core-js-pure/internals/v8-prototype-define-bug.js
var require_v8_prototype_define_bug = __commonJS({
  "node_modules/core-js-pure/internals/v8-prototype-define-bug.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var DESCRIPTORS = require_descriptors();
    var fails = require_fails();
    module.exports = DESCRIPTORS && fails(function() {
      return Object.defineProperty(function() {
      }, "prototype", {
        value: 42,
        writable: false
      }).prototype !== 42;
    });
  }
});

// node_modules/core-js-pure/internals/an-object.js
var require_an_object = __commonJS({
  "node_modules/core-js-pure/internals/an-object.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var isObject2 = require_is_object();
    var $String = String;
    var $TypeError = TypeError;
    module.exports = function(argument) {
      if (isObject2(argument)) return argument;
      throw new $TypeError($String(argument) + " is not an object");
    };
  }
});

// node_modules/core-js-pure/internals/object-define-property.js
var require_object_define_property = __commonJS({
  "node_modules/core-js-pure/internals/object-define-property.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var DESCRIPTORS = require_descriptors();
    var IE8_DOM_DEFINE = require_ie8_dom_define();
    var V8_PROTOTYPE_DEFINE_BUG = require_v8_prototype_define_bug();
    var anObject = require_an_object();
    var toPropertyKey2 = require_to_property_key();
    var $TypeError = TypeError;
    var $defineProperty = Object.defineProperty;
    var $getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    var ENUMERABLE = "enumerable";
    var CONFIGURABLE = "configurable";
    var WRITABLE = "writable";
    exports.f = DESCRIPTORS ? V8_PROTOTYPE_DEFINE_BUG ? /* @__PURE__ */ __name(function defineProperty(O, P, Attributes) {
      anObject(O);
      P = toPropertyKey2(P);
      anObject(Attributes);
      if (typeof O === "function" && P === "prototype" && "value" in Attributes && WRITABLE in Attributes && !Attributes[WRITABLE]) {
        var current = $getOwnPropertyDescriptor(O, P);
        if (current && current[WRITABLE]) {
          O[P] = Attributes.value;
          Attributes = {
            configurable: CONFIGURABLE in Attributes ? Attributes[CONFIGURABLE] : current[CONFIGURABLE],
            enumerable: ENUMERABLE in Attributes ? Attributes[ENUMERABLE] : current[ENUMERABLE],
            writable: false
          };
        }
      }
      return $defineProperty(O, P, Attributes);
    }, "defineProperty") : $defineProperty : /* @__PURE__ */ __name(function defineProperty(O, P, Attributes) {
      anObject(O);
      P = toPropertyKey2(P);
      anObject(Attributes);
      if (IE8_DOM_DEFINE) try {
        return $defineProperty(O, P, Attributes);
      } catch (error3) {
      }
      if ("get" in Attributes || "set" in Attributes) throw new $TypeError("Accessors not supported");
      if ("value" in Attributes) O[P] = Attributes.value;
      return O;
    }, "defineProperty");
  }
});

// node_modules/core-js-pure/internals/create-non-enumerable-property.js
var require_create_non_enumerable_property = __commonJS({
  "node_modules/core-js-pure/internals/create-non-enumerable-property.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var DESCRIPTORS = require_descriptors();
    var definePropertyModule = require_object_define_property();
    var createPropertyDescriptor = require_create_property_descriptor();
    module.exports = DESCRIPTORS ? function(object, key, value) {
      return definePropertyModule.f(object, key, createPropertyDescriptor(1, value));
    } : function(object, key, value) {
      object[key] = value;
      return object;
    };
  }
});

// node_modules/core-js-pure/internals/export.js
var require_export = __commonJS({
  "node_modules/core-js-pure/internals/export.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var globalThis2 = require_global_this();
    var apply = require_function_apply();
    var uncurryThis = require_function_uncurry_this_clause();
    var isCallable = require_is_callable();
    var getOwnPropertyDescriptor = require_object_get_own_property_descriptor().f;
    var isForced = require_is_forced();
    var path = require_path();
    var bind = require_function_bind_context();
    var createNonEnumerableProperty = require_create_non_enumerable_property();
    var hasOwn = require_has_own_property();
    require_shared_store();
    var wrapConstructor = /* @__PURE__ */ __name(function(NativeConstructor) {
      var Wrapper = /* @__PURE__ */ __name(function(a2, b, c2) {
        if (this instanceof Wrapper) {
          switch (arguments.length) {
            case 0:
              return new NativeConstructor();
            case 1:
              return new NativeConstructor(a2);
            case 2:
              return new NativeConstructor(a2, b);
          }
          return new NativeConstructor(a2, b, c2);
        }
        return apply(NativeConstructor, this, arguments);
      }, "Wrapper");
      Wrapper.prototype = NativeConstructor.prototype;
      return Wrapper;
    }, "wrapConstructor");
    module.exports = function(options, source) {
      var TARGET = options.target;
      var GLOBAL = options.global;
      var STATIC = options.stat;
      var PROTO = options.proto;
      var nativeSource = GLOBAL ? globalThis2 : STATIC ? globalThis2[TARGET] : globalThis2[TARGET] && globalThis2[TARGET].prototype;
      var target = GLOBAL ? path : path[TARGET] || createNonEnumerableProperty(path, TARGET, {})[TARGET];
      var targetPrototype = target.prototype;
      var FORCED, USE_NATIVE, VIRTUAL_PROTOTYPE;
      var key, sourceProperty, targetProperty, nativeProperty, resultProperty, descriptor;
      for (key in source) {
        FORCED = isForced(GLOBAL ? key : TARGET + (STATIC ? "." : "#") + key, options.forced);
        USE_NATIVE = !FORCED && nativeSource && hasOwn(nativeSource, key);
        targetProperty = target[key];
        if (USE_NATIVE) if (options.dontCallGetSet) {
          descriptor = getOwnPropertyDescriptor(nativeSource, key);
          nativeProperty = descriptor && descriptor.value;
        } else nativeProperty = nativeSource[key];
        sourceProperty = USE_NATIVE && nativeProperty ? nativeProperty : source[key];
        if (!FORCED && !PROTO && typeof targetProperty == typeof sourceProperty) continue;
        if (options.bind && USE_NATIVE) resultProperty = bind(sourceProperty, globalThis2);
        else if (options.wrap && USE_NATIVE) resultProperty = wrapConstructor(sourceProperty);
        else if (PROTO && isCallable(sourceProperty)) resultProperty = uncurryThis(sourceProperty);
        else resultProperty = sourceProperty;
        if (options.sham || sourceProperty && sourceProperty.sham || targetProperty && targetProperty.sham) {
          createNonEnumerableProperty(resultProperty, "sham", true);
        }
        createNonEnumerableProperty(target, key, resultProperty);
        if (PROTO) {
          VIRTUAL_PROTOTYPE = TARGET + "Prototype";
          if (!hasOwn(path, VIRTUAL_PROTOTYPE)) {
            createNonEnumerableProperty(path, VIRTUAL_PROTOTYPE, {});
          }
          createNonEnumerableProperty(path[VIRTUAL_PROTOTYPE], key, sourceProperty);
          if (options.real && targetPrototype && (FORCED || !targetPrototype[key])) {
            createNonEnumerableProperty(targetPrototype, key, sourceProperty);
          }
        }
      }
    };
  }
});

// node_modules/core-js-pure/modules/es.object.define-property.js
var require_es_object_define_property = __commonJS({
  "node_modules/core-js-pure/modules/es.object.define-property.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $ = require_export();
    var DESCRIPTORS = require_descriptors();
    var defineProperty = require_object_define_property().f;
    $({ target: "Object", stat: true, forced: Object.defineProperty !== defineProperty, sham: !DESCRIPTORS }, {
      defineProperty
    });
  }
});

// node_modules/core-js-pure/es/object/define-property.js
var require_define_property = __commonJS({
  "node_modules/core-js-pure/es/object/define-property.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    require_es_object_define_property();
    var path = require_path();
    var Object2 = path.Object;
    var $defineProperty = module.exports = /* @__PURE__ */ __name(function defineProperty(it, key, desc) {
      return Object2.defineProperty(it, key, desc);
    }, "defineProperty");
    if (Object2.defineProperty.sham) $defineProperty.sham = true;
  }
});

// node_modules/core-js-pure/stable/object/define-property.js
var require_define_property2 = __commonJS({
  "node_modules/core-js-pure/stable/object/define-property.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_define_property();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/actual/object/define-property.js
var require_define_property3 = __commonJS({
  "node_modules/core-js-pure/actual/object/define-property.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_define_property2();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/full/object/define-property.js
var require_define_property4 = __commonJS({
  "node_modules/core-js-pure/full/object/define-property.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_define_property3();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/features/object/define-property.js
var require_define_property5 = __commonJS({
  "node_modules/core-js-pure/features/object/define-property.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = require_define_property4();
  }
});

// node_modules/core-js-pure/internals/is-array.js
var require_is_array = __commonJS({
  "node_modules/core-js-pure/internals/is-array.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var classof = require_classof_raw();
    module.exports = Array.isArray || /* @__PURE__ */ __name(function isArray(argument) {
      return classof(argument) === "Array";
    }, "isArray");
  }
});

// node_modules/core-js-pure/internals/math-trunc.js
var require_math_trunc = __commonJS({
  "node_modules/core-js-pure/internals/math-trunc.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var ceil = Math.ceil;
    var floor = Math.floor;
    module.exports = Math.trunc || /* @__PURE__ */ __name(function trunc(x) {
      var n2 = +x;
      return (n2 > 0 ? floor : ceil)(n2);
    }, "trunc");
  }
});

// node_modules/core-js-pure/internals/to-integer-or-infinity.js
var require_to_integer_or_infinity = __commonJS({
  "node_modules/core-js-pure/internals/to-integer-or-infinity.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var trunc = require_math_trunc();
    module.exports = function(argument) {
      var number = +argument;
      return number !== number || number === 0 ? 0 : trunc(number);
    };
  }
});

// node_modules/core-js-pure/internals/to-length.js
var require_to_length = __commonJS({
  "node_modules/core-js-pure/internals/to-length.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var toIntegerOrInfinity = require_to_integer_or_infinity();
    var min = Math.min;
    module.exports = function(argument) {
      var len = toIntegerOrInfinity(argument);
      return len > 0 ? min(len, 9007199254740991) : 0;
    };
  }
});

// node_modules/core-js-pure/internals/length-of-array-like.js
var require_length_of_array_like = __commonJS({
  "node_modules/core-js-pure/internals/length-of-array-like.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var toLength = require_to_length();
    module.exports = function(obj) {
      return toLength(obj.length);
    };
  }
});

// node_modules/core-js-pure/internals/does-not-exceed-safe-integer.js
var require_does_not_exceed_safe_integer = __commonJS({
  "node_modules/core-js-pure/internals/does-not-exceed-safe-integer.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $TypeError = TypeError;
    var MAX_SAFE_INTEGER = 9007199254740991;
    module.exports = function(it) {
      if (it > MAX_SAFE_INTEGER) throw new $TypeError("Maximum allowed index exceeded");
      return it;
    };
  }
});

// node_modules/core-js-pure/internals/create-property.js
var require_create_property = __commonJS({
  "node_modules/core-js-pure/internals/create-property.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var DESCRIPTORS = require_descriptors();
    var definePropertyModule = require_object_define_property();
    var createPropertyDescriptor = require_create_property_descriptor();
    module.exports = function(object, key, value) {
      if (DESCRIPTORS) definePropertyModule.f(object, key, createPropertyDescriptor(0, value));
      else object[key] = value;
    };
  }
});

// node_modules/core-js-pure/internals/array-set-length.js
var require_array_set_length = __commonJS({
  "node_modules/core-js-pure/internals/array-set-length.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var DESCRIPTORS = require_descriptors();
    var isArray = require_is_array();
    var $TypeError = TypeError;
    var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    var SILENT_ON_NON_WRITABLE_LENGTH_SET = DESCRIPTORS && !(function() {
      if (this !== void 0) return true;
      try {
        Object.defineProperty([], "length", { writable: false }).length = 1;
      } catch (error3) {
        return error3 instanceof TypeError;
      }
    })();
    module.exports = SILENT_ON_NON_WRITABLE_LENGTH_SET ? function(O, length) {
      if (isArray(O) && !getOwnPropertyDescriptor(O, "length").writable) {
        throw new $TypeError("Cannot set read only .length");
      }
      return O.length = length;
    } : function(O, length) {
      return O.length = length;
    };
  }
});

// node_modules/core-js-pure/internals/to-string-tag-support.js
var require_to_string_tag_support = __commonJS({
  "node_modules/core-js-pure/internals/to-string-tag-support.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var wellKnownSymbol = require_well_known_symbol();
    var TO_STRING_TAG = wellKnownSymbol("toStringTag");
    var test = {};
    test[TO_STRING_TAG] = "z";
    module.exports = String(test) === "[object z]";
  }
});

// node_modules/core-js-pure/internals/classof.js
var require_classof = __commonJS({
  "node_modules/core-js-pure/internals/classof.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var TO_STRING_TAG_SUPPORT = require_to_string_tag_support();
    var isCallable = require_is_callable();
    var classofRaw = require_classof_raw();
    var wellKnownSymbol = require_well_known_symbol();
    var TO_STRING_TAG = wellKnownSymbol("toStringTag");
    var $Object = Object;
    var CORRECT_ARGUMENTS = classofRaw(/* @__PURE__ */ (function() {
      return arguments;
    })()) === "Arguments";
    var tryGet = /* @__PURE__ */ __name(function(it, key) {
      try {
        return it[key];
      } catch (error3) {
      }
    }, "tryGet");
    module.exports = TO_STRING_TAG_SUPPORT ? classofRaw : function(it) {
      var O, tag2, result;
      return it === void 0 ? "Undefined" : it === null ? "Null" : typeof (tag2 = tryGet(O = $Object(it), TO_STRING_TAG)) == "string" ? tag2 : CORRECT_ARGUMENTS ? classofRaw(O) : (result = classofRaw(O)) === "Object" && isCallable(O.callee) ? "Arguments" : result;
    };
  }
});

// node_modules/core-js-pure/internals/inspect-source.js
var require_inspect_source = __commonJS({
  "node_modules/core-js-pure/internals/inspect-source.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this();
    var isCallable = require_is_callable();
    var store = require_shared_store();
    var functionToString = uncurryThis(Function.toString);
    if (!isCallable(store.inspectSource)) {
      store.inspectSource = function(it) {
        return functionToString(it);
      };
    }
    module.exports = store.inspectSource;
  }
});

// node_modules/core-js-pure/internals/is-constructor.js
var require_is_constructor = __commonJS({
  "node_modules/core-js-pure/internals/is-constructor.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this();
    var fails = require_fails();
    var isCallable = require_is_callable();
    var classof = require_classof();
    var getBuiltIn = require_get_built_in();
    var inspectSource = require_inspect_source();
    var noop = /* @__PURE__ */ __name(function() {
    }, "noop");
    var construct = getBuiltIn("Reflect", "construct");
    var constructorRegExp = /^\s*(?:class|function)\b/;
    var exec = uncurryThis(constructorRegExp.exec);
    var INCORRECT_TO_STRING = !constructorRegExp.test(noop);
    var isConstructorModern = /* @__PURE__ */ __name(function isConstructor(argument) {
      if (!isCallable(argument)) return false;
      try {
        construct(noop, [], argument);
        return true;
      } catch (error3) {
        return false;
      }
    }, "isConstructor");
    var isConstructorLegacy = /* @__PURE__ */ __name(function isConstructor(argument) {
      if (!isCallable(argument)) return false;
      switch (classof(argument)) {
        case "AsyncFunction":
        case "GeneratorFunction":
        case "AsyncGeneratorFunction":
          return false;
      }
      try {
        return INCORRECT_TO_STRING || !!exec(constructorRegExp, inspectSource(argument));
      } catch (error3) {
        return true;
      }
    }, "isConstructor");
    isConstructorLegacy.sham = true;
    module.exports = !construct || fails(function() {
      var called;
      return isConstructorModern(isConstructorModern.call) || !isConstructorModern(Object) || !isConstructorModern(function() {
        called = true;
      }) || called;
    }) ? isConstructorLegacy : isConstructorModern;
  }
});

// node_modules/core-js-pure/internals/array-species-constructor.js
var require_array_species_constructor = __commonJS({
  "node_modules/core-js-pure/internals/array-species-constructor.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var isArray = require_is_array();
    var isConstructor = require_is_constructor();
    var isObject2 = require_is_object();
    var wellKnownSymbol = require_well_known_symbol();
    var SPECIES = wellKnownSymbol("species");
    var $Array = Array;
    module.exports = function(originalArray) {
      var C;
      if (isArray(originalArray)) {
        C = originalArray.constructor;
        if (isConstructor(C) && (C === $Array || isArray(C.prototype))) C = void 0;
        else if (isObject2(C)) {
          C = C[SPECIES];
          if (C === null) C = void 0;
        }
      }
      return C === void 0 ? $Array : C;
    };
  }
});

// node_modules/core-js-pure/internals/array-species-create.js
var require_array_species_create = __commonJS({
  "node_modules/core-js-pure/internals/array-species-create.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var arraySpeciesConstructor = require_array_species_constructor();
    module.exports = function(originalArray, length) {
      return new (arraySpeciesConstructor(originalArray))(length === 0 ? 0 : length);
    };
  }
});

// node_modules/core-js-pure/internals/array-method-has-species-support.js
var require_array_method_has_species_support = __commonJS({
  "node_modules/core-js-pure/internals/array-method-has-species-support.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var fails = require_fails();
    var wellKnownSymbol = require_well_known_symbol();
    var V8_VERSION = require_environment_v8_version();
    var SPECIES = wellKnownSymbol("species");
    module.exports = function(METHOD_NAME) {
      return V8_VERSION >= 51 || !fails(function() {
        var array = [];
        var constructor = array.constructor = {};
        constructor[SPECIES] = function() {
          return { foo: 1 };
        };
        return array[METHOD_NAME](Boolean).foo !== 1;
      });
    };
  }
});

// node_modules/core-js-pure/modules/es.array.concat.js
var require_es_array_concat = __commonJS({
  "node_modules/core-js-pure/modules/es.array.concat.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $ = require_export();
    var fails = require_fails();
    var isArray = require_is_array();
    var isObject2 = require_is_object();
    var toObject = require_to_object();
    var lengthOfArrayLike = require_length_of_array_like();
    var doesNotExceedSafeInteger = require_does_not_exceed_safe_integer();
    var createProperty = require_create_property();
    var setArrayLength = require_array_set_length();
    var arraySpeciesCreate = require_array_species_create();
    var arrayMethodHasSpeciesSupport = require_array_method_has_species_support();
    var wellKnownSymbol = require_well_known_symbol();
    var V8_VERSION = require_environment_v8_version();
    var IS_CONCAT_SPREADABLE = wellKnownSymbol("isConcatSpreadable");
    var IS_CONCAT_SPREADABLE_SUPPORT = V8_VERSION >= 51 || !fails(function() {
      var array = [];
      array[IS_CONCAT_SPREADABLE] = false;
      return array.concat()[0] !== array;
    });
    var isConcatSpreadable = /* @__PURE__ */ __name(function(O) {
      if (!isObject2(O)) return false;
      var spreadable = O[IS_CONCAT_SPREADABLE];
      return spreadable !== void 0 ? !!spreadable : isArray(O);
    }, "isConcatSpreadable");
    var FORCED = !IS_CONCAT_SPREADABLE_SUPPORT || !arrayMethodHasSpeciesSupport("concat");
    $({ target: "Array", proto: true, arity: 1, forced: FORCED }, {
      // eslint-disable-next-line no-unused-vars -- required for `.length`
      concat: /* @__PURE__ */ __name(function concat2(arg) {
        var O = toObject(this);
        var A = arraySpeciesCreate(O, 0);
        var n2 = 0;
        var i2, k, length, len, E;
        for (i2 = -1, length = arguments.length; i2 < length; i2++) {
          E = i2 === -1 ? O : arguments[i2];
          if (isConcatSpreadable(E)) {
            len = lengthOfArrayLike(E);
            doesNotExceedSafeInteger(n2 + len);
            for (k = 0; k < len; k++, n2++) if (k in E) createProperty(A, n2, E[k]);
          } else {
            doesNotExceedSafeInteger(n2 + 1);
            createProperty(A, n2++, E);
          }
        }
        setArrayLength(A, n2);
        return A;
      }, "concat")
    });
  }
});

// node_modules/core-js-pure/modules/es.object.to-string.js
var require_es_object_to_string = __commonJS({
  "node_modules/core-js-pure/modules/es.object.to-string.js"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
  }
});

// node_modules/core-js-pure/internals/to-string.js
var require_to_string = __commonJS({
  "node_modules/core-js-pure/internals/to-string.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var classof = require_classof();
    var $String = String;
    module.exports = function(argument) {
      if (classof(argument) === "Symbol") throw new TypeError("Cannot convert a Symbol value to a string");
      return $String(argument);
    };
  }
});

// node_modules/core-js-pure/internals/to-absolute-index.js
var require_to_absolute_index = __commonJS({
  "node_modules/core-js-pure/internals/to-absolute-index.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var toIntegerOrInfinity = require_to_integer_or_infinity();
    var max = Math.max;
    var min = Math.min;
    module.exports = function(index, length) {
      var integer = toIntegerOrInfinity(index);
      return integer < 0 ? max(integer + length, 0) : min(integer, length);
    };
  }
});

// node_modules/core-js-pure/internals/array-includes.js
var require_array_includes = __commonJS({
  "node_modules/core-js-pure/internals/array-includes.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var toIndexedObject = require_to_indexed_object();
    var toAbsoluteIndex = require_to_absolute_index();
    var lengthOfArrayLike = require_length_of_array_like();
    var createMethod = /* @__PURE__ */ __name(function(IS_INCLUDES) {
      return function($this, el, fromIndex) {
        var O = toIndexedObject($this);
        var length = lengthOfArrayLike(O);
        if (length === 0) return !IS_INCLUDES && -1;
        var index = toAbsoluteIndex(fromIndex, length);
        var value;
        if (IS_INCLUDES && el !== el) while (length > index) {
          value = O[index++];
          if (value !== value) return true;
        }
        else for (; length > index; index++) {
          if ((IS_INCLUDES || index in O) && O[index] === el) return IS_INCLUDES || index || 0;
        }
        return !IS_INCLUDES && -1;
      };
    }, "createMethod");
    module.exports = {
      // `Array.prototype.includes` method
      // https://tc39.es/ecma262/#sec-array.prototype.includes
      includes: createMethod(true),
      // `Array.prototype.indexOf` method
      // https://tc39.es/ecma262/#sec-array.prototype.indexof
      indexOf: createMethod(false)
    };
  }
});

// node_modules/core-js-pure/internals/hidden-keys.js
var require_hidden_keys = __commonJS({
  "node_modules/core-js-pure/internals/hidden-keys.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = {};
  }
});

// node_modules/core-js-pure/internals/object-keys-internal.js
var require_object_keys_internal = __commonJS({
  "node_modules/core-js-pure/internals/object-keys-internal.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this();
    var hasOwn = require_has_own_property();
    var toIndexedObject = require_to_indexed_object();
    var indexOf = require_array_includes().indexOf;
    var hiddenKeys = require_hidden_keys();
    var push = uncurryThis([].push);
    module.exports = function(object, names) {
      var O = toIndexedObject(object);
      var i2 = 0;
      var result = [];
      var key;
      for (key in O) !hasOwn(hiddenKeys, key) && hasOwn(O, key) && push(result, key);
      while (names.length > i2) if (hasOwn(O, key = names[i2++])) {
        ~indexOf(result, key) || push(result, key);
      }
      return result;
    };
  }
});

// node_modules/core-js-pure/internals/enum-bug-keys.js
var require_enum_bug_keys = __commonJS({
  "node_modules/core-js-pure/internals/enum-bug-keys.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = [
      "constructor",
      "hasOwnProperty",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString",
      "toString",
      "valueOf"
    ];
  }
});

// node_modules/core-js-pure/internals/object-keys.js
var require_object_keys = __commonJS({
  "node_modules/core-js-pure/internals/object-keys.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var internalObjectKeys = require_object_keys_internal();
    var enumBugKeys = require_enum_bug_keys();
    module.exports = Object.keys || /* @__PURE__ */ __name(function keys(O) {
      return internalObjectKeys(O, enumBugKeys);
    }, "keys");
  }
});

// node_modules/core-js-pure/internals/object-define-properties.js
var require_object_define_properties = __commonJS({
  "node_modules/core-js-pure/internals/object-define-properties.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var DESCRIPTORS = require_descriptors();
    var V8_PROTOTYPE_DEFINE_BUG = require_v8_prototype_define_bug();
    var definePropertyModule = require_object_define_property();
    var anObject = require_an_object();
    var toIndexedObject = require_to_indexed_object();
    var objectKeys = require_object_keys();
    exports.f = DESCRIPTORS && !V8_PROTOTYPE_DEFINE_BUG ? Object.defineProperties : /* @__PURE__ */ __name(function defineProperties(O, Properties) {
      anObject(O);
      var props = toIndexedObject(Properties);
      var keys = objectKeys(Properties);
      var length = keys.length;
      var index = 0;
      var key;
      while (length > index) definePropertyModule.f(O, key = keys[index++], props[key]);
      return O;
    }, "defineProperties");
  }
});

// node_modules/core-js-pure/internals/html.js
var require_html = __commonJS({
  "node_modules/core-js-pure/internals/html.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var getBuiltIn = require_get_built_in();
    module.exports = getBuiltIn("document", "documentElement");
  }
});

// node_modules/core-js-pure/internals/shared-key.js
var require_shared_key = __commonJS({
  "node_modules/core-js-pure/internals/shared-key.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var shared = require_shared();
    var uid = require_uid();
    var keys = shared("keys");
    module.exports = function(key) {
      return keys[key] || (keys[key] = uid(key));
    };
  }
});

// node_modules/core-js-pure/internals/object-create.js
var require_object_create = __commonJS({
  "node_modules/core-js-pure/internals/object-create.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var anObject = require_an_object();
    var definePropertiesModule = require_object_define_properties();
    var enumBugKeys = require_enum_bug_keys();
    var hiddenKeys = require_hidden_keys();
    var html = require_html();
    var documentCreateElement = require_document_create_element();
    var sharedKey = require_shared_key();
    var GT = ">";
    var LT = "<";
    var PROTOTYPE = "prototype";
    var SCRIPT = "script";
    var IE_PROTO = sharedKey("IE_PROTO");
    var EmptyConstructor = /* @__PURE__ */ __name(function() {
    }, "EmptyConstructor");
    var scriptTag = /* @__PURE__ */ __name(function(content) {
      return LT + SCRIPT + GT + content + LT + "/" + SCRIPT + GT;
    }, "scriptTag");
    var NullProtoObjectViaActiveX = /* @__PURE__ */ __name(function(activeXDocument2) {
      activeXDocument2.write(scriptTag(""));
      activeXDocument2.close();
      var temp = activeXDocument2.parentWindow.Object;
      activeXDocument2 = null;
      return temp;
    }, "NullProtoObjectViaActiveX");
    var NullProtoObjectViaIFrame = /* @__PURE__ */ __name(function() {
      var iframe = documentCreateElement("iframe");
      var JS = "java" + SCRIPT + ":";
      var iframeDocument;
      iframe.style.display = "none";
      html.appendChild(iframe);
      iframe.src = String(JS);
      iframeDocument = iframe.contentWindow.document;
      iframeDocument.open();
      iframeDocument.write(scriptTag("document.F=Object"));
      iframeDocument.close();
      return iframeDocument.F;
    }, "NullProtoObjectViaIFrame");
    var activeXDocument;
    var NullProtoObject = /* @__PURE__ */ __name(function() {
      try {
        activeXDocument = new ActiveXObject("htmlfile");
      } catch (error3) {
      }
      NullProtoObject = typeof document != "undefined" ? document.domain && activeXDocument ? NullProtoObjectViaActiveX(activeXDocument) : NullProtoObjectViaIFrame() : NullProtoObjectViaActiveX(activeXDocument);
      var length = enumBugKeys.length;
      while (length--) delete NullProtoObject[PROTOTYPE][enumBugKeys[length]];
      return NullProtoObject();
    }, "NullProtoObject");
    hiddenKeys[IE_PROTO] = true;
    module.exports = Object.create || /* @__PURE__ */ __name(function create(O, Properties) {
      var result;
      if (O !== null) {
        EmptyConstructor[PROTOTYPE] = anObject(O);
        result = new EmptyConstructor();
        EmptyConstructor[PROTOTYPE] = null;
        result[IE_PROTO] = O;
      } else result = NullProtoObject();
      return Properties === void 0 ? result : definePropertiesModule.f(result, Properties);
    }, "create");
  }
});

// node_modules/core-js-pure/internals/object-get-own-property-names.js
var require_object_get_own_property_names = __commonJS({
  "node_modules/core-js-pure/internals/object-get-own-property-names.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var internalObjectKeys = require_object_keys_internal();
    var enumBugKeys = require_enum_bug_keys();
    var hiddenKeys = enumBugKeys.concat("length", "prototype");
    exports.f = Object.getOwnPropertyNames || /* @__PURE__ */ __name(function getOwnPropertyNames(O) {
      return internalObjectKeys(O, hiddenKeys);
    }, "getOwnPropertyNames");
  }
});

// node_modules/core-js-pure/internals/array-slice.js
var require_array_slice = __commonJS({
  "node_modules/core-js-pure/internals/array-slice.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this();
    module.exports = uncurryThis([].slice);
  }
});

// node_modules/core-js-pure/internals/object-get-own-property-names-external.js
var require_object_get_own_property_names_external = __commonJS({
  "node_modules/core-js-pure/internals/object-get-own-property-names-external.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var classof = require_classof_raw();
    var toIndexedObject = require_to_indexed_object();
    var $getOwnPropertyNames = require_object_get_own_property_names().f;
    var arraySlice = require_array_slice();
    var windowNames = typeof window == "object" && window && Object.getOwnPropertyNames ? Object.getOwnPropertyNames(window) : [];
    var getWindowNames = /* @__PURE__ */ __name(function(it) {
      try {
        return $getOwnPropertyNames(it);
      } catch (error3) {
        return arraySlice(windowNames);
      }
    }, "getWindowNames");
    module.exports.f = /* @__PURE__ */ __name(function getOwnPropertyNames(it) {
      return windowNames && classof(it) === "Window" ? getWindowNames(it) : $getOwnPropertyNames(toIndexedObject(it));
    }, "getOwnPropertyNames");
  }
});

// node_modules/core-js-pure/internals/object-get-own-property-symbols.js
var require_object_get_own_property_symbols = __commonJS({
  "node_modules/core-js-pure/internals/object-get-own-property-symbols.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    exports.f = Object.getOwnPropertySymbols;
  }
});

// node_modules/core-js-pure/internals/define-built-in.js
var require_define_built_in = __commonJS({
  "node_modules/core-js-pure/internals/define-built-in.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var createNonEnumerableProperty = require_create_non_enumerable_property();
    module.exports = function(target, key, value, options) {
      if (options && options.enumerable) target[key] = value;
      else createNonEnumerableProperty(target, key, value);
      return target;
    };
  }
});

// node_modules/core-js-pure/internals/define-built-in-accessor.js
var require_define_built_in_accessor = __commonJS({
  "node_modules/core-js-pure/internals/define-built-in-accessor.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineProperty = require_object_define_property();
    module.exports = function(target, name, descriptor) {
      return defineProperty.f(target, name, descriptor);
    };
  }
});

// node_modules/core-js-pure/internals/well-known-symbol-wrapped.js
var require_well_known_symbol_wrapped = __commonJS({
  "node_modules/core-js-pure/internals/well-known-symbol-wrapped.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var wellKnownSymbol = require_well_known_symbol();
    exports.f = wellKnownSymbol;
  }
});

// node_modules/core-js-pure/internals/well-known-symbol-define.js
var require_well_known_symbol_define = __commonJS({
  "node_modules/core-js-pure/internals/well-known-symbol-define.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var path = require_path();
    var hasOwn = require_has_own_property();
    var wrappedWellKnownSymbolModule = require_well_known_symbol_wrapped();
    var defineProperty = require_object_define_property().f;
    module.exports = function(NAME) {
      var Symbol2 = path.Symbol || (path.Symbol = {});
      if (!hasOwn(Symbol2, NAME)) defineProperty(Symbol2, NAME, {
        value: wrappedWellKnownSymbolModule.f(NAME)
      });
    };
  }
});

// node_modules/core-js-pure/internals/symbol-define-to-primitive.js
var require_symbol_define_to_primitive = __commonJS({
  "node_modules/core-js-pure/internals/symbol-define-to-primitive.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var call = require_function_call();
    var getBuiltIn = require_get_built_in();
    var wellKnownSymbol = require_well_known_symbol();
    var defineBuiltIn = require_define_built_in();
    module.exports = function() {
      var Symbol2 = getBuiltIn("Symbol");
      var SymbolPrototype = Symbol2 && Symbol2.prototype;
      var valueOf = SymbolPrototype && SymbolPrototype.valueOf;
      var TO_PRIMITIVE = wellKnownSymbol("toPrimitive");
      if (SymbolPrototype && !SymbolPrototype[TO_PRIMITIVE]) {
        defineBuiltIn(SymbolPrototype, TO_PRIMITIVE, function(hint) {
          return call(valueOf, this);
        }, { arity: 1 });
      }
    };
  }
});

// node_modules/core-js-pure/internals/object-to-string.js
var require_object_to_string = __commonJS({
  "node_modules/core-js-pure/internals/object-to-string.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var TO_STRING_TAG_SUPPORT = require_to_string_tag_support();
    var classof = require_classof();
    module.exports = TO_STRING_TAG_SUPPORT ? {}.toString : /* @__PURE__ */ __name(function toString() {
      return "[object " + classof(this) + "]";
    }, "toString");
  }
});

// node_modules/core-js-pure/internals/set-to-string-tag.js
var require_set_to_string_tag = __commonJS({
  "node_modules/core-js-pure/internals/set-to-string-tag.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var TO_STRING_TAG_SUPPORT = require_to_string_tag_support();
    var defineProperty = require_object_define_property().f;
    var createNonEnumerableProperty = require_create_non_enumerable_property();
    var hasOwn = require_has_own_property();
    var toString = require_object_to_string();
    var wellKnownSymbol = require_well_known_symbol();
    var TO_STRING_TAG = wellKnownSymbol("toStringTag");
    module.exports = function(it, TAG, STATIC, SET_METHOD) {
      var target = STATIC ? it : it && it.prototype;
      if (target) {
        if (!hasOwn(target, TO_STRING_TAG)) {
          defineProperty(target, TO_STRING_TAG, { configurable: true, value: TAG });
        }
        if (SET_METHOD && !TO_STRING_TAG_SUPPORT) {
          createNonEnumerableProperty(target, "toString", toString);
        }
      }
    };
  }
});

// node_modules/core-js-pure/internals/weak-map-basic-detection.js
var require_weak_map_basic_detection = __commonJS({
  "node_modules/core-js-pure/internals/weak-map-basic-detection.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var globalThis2 = require_global_this();
    var isCallable = require_is_callable();
    var WeakMap2 = globalThis2.WeakMap;
    module.exports = isCallable(WeakMap2) && /native code/.test(String(WeakMap2));
  }
});

// node_modules/core-js-pure/internals/internal-state.js
var require_internal_state = __commonJS({
  "node_modules/core-js-pure/internals/internal-state.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var NATIVE_WEAK_MAP = require_weak_map_basic_detection();
    var globalThis2 = require_global_this();
    var isObject2 = require_is_object();
    var createNonEnumerableProperty = require_create_non_enumerable_property();
    var hasOwn = require_has_own_property();
    var shared = require_shared_store();
    var sharedKey = require_shared_key();
    var hiddenKeys = require_hidden_keys();
    var OBJECT_ALREADY_INITIALIZED = "Object already initialized";
    var TypeError2 = globalThis2.TypeError;
    var WeakMap2 = globalThis2.WeakMap;
    var set;
    var get;
    var has;
    var enforce = /* @__PURE__ */ __name(function(it) {
      return has(it) ? get(it) : set(it, {});
    }, "enforce");
    var getterFor = /* @__PURE__ */ __name(function(TYPE) {
      return function(it) {
        var state;
        if (!isObject2(it) || (state = get(it)).type !== TYPE) {
          throw new TypeError2("Incompatible receiver, " + TYPE + " required");
        }
        return state;
      };
    }, "getterFor");
    if (NATIVE_WEAK_MAP || shared.state) {
      store = shared.state || (shared.state = new WeakMap2());
      store.get = store.get;
      store.has = store.has;
      store.set = store.set;
      set = /* @__PURE__ */ __name(function(it, metadata) {
        if (store.has(it)) throw new TypeError2(OBJECT_ALREADY_INITIALIZED);
        metadata.facade = it;
        store.set(it, metadata);
        return metadata;
      }, "set");
      get = /* @__PURE__ */ __name(function(it) {
        return store.get(it) || {};
      }, "get");
      has = /* @__PURE__ */ __name(function(it) {
        return store.has(it);
      }, "has");
    } else {
      STATE = sharedKey("state");
      hiddenKeys[STATE] = true;
      set = /* @__PURE__ */ __name(function(it, metadata) {
        if (hasOwn(it, STATE)) throw new TypeError2(OBJECT_ALREADY_INITIALIZED);
        metadata.facade = it;
        createNonEnumerableProperty(it, STATE, metadata);
        return metadata;
      }, "set");
      get = /* @__PURE__ */ __name(function(it) {
        return hasOwn(it, STATE) ? it[STATE] : {};
      }, "get");
      has = /* @__PURE__ */ __name(function(it) {
        return hasOwn(it, STATE);
      }, "has");
    }
    var store;
    var STATE;
    module.exports = {
      set,
      get,
      has,
      enforce,
      getterFor
    };
  }
});

// node_modules/core-js-pure/internals/array-iteration.js
var require_array_iteration = __commonJS({
  "node_modules/core-js-pure/internals/array-iteration.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var bind = require_function_bind_context();
    var IndexedObject = require_indexed_object();
    var toObject = require_to_object();
    var lengthOfArrayLike = require_length_of_array_like();
    var arraySpeciesCreate = require_array_species_create();
    var createProperty = require_create_property();
    var createMethod = /* @__PURE__ */ __name(function(TYPE) {
      var IS_MAP = TYPE === 1;
      var IS_FILTER = TYPE === 2;
      var IS_SOME = TYPE === 3;
      var IS_EVERY = TYPE === 4;
      var IS_FIND_INDEX = TYPE === 6;
      var IS_FILTER_REJECT = TYPE === 7;
      var NO_HOLES = TYPE === 5 || IS_FIND_INDEX;
      return function($this, callbackfn, that) {
        var O = toObject($this);
        var self2 = IndexedObject(O);
        var length = lengthOfArrayLike(self2);
        var boundFunction = bind(callbackfn, that);
        var index = 0;
        var resIndex = 0;
        var target = IS_MAP ? arraySpeciesCreate($this, length) : IS_FILTER || IS_FILTER_REJECT ? arraySpeciesCreate($this, 0) : void 0;
        var value, result;
        for (; length > index; index++) if (NO_HOLES || index in self2) {
          value = self2[index];
          result = boundFunction(value, index, O);
          if (TYPE) {
            if (IS_MAP) createProperty(target, index, result);
            else if (result) switch (TYPE) {
              case 3:
                return true;
              // some
              case 5:
                return value;
              // find
              case 6:
                return index;
              // findIndex
              case 2:
                createProperty(target, resIndex++, value);
            }
            else switch (TYPE) {
              case 4:
                return false;
              // every
              case 7:
                createProperty(target, resIndex++, value);
            }
          }
        }
        return IS_FIND_INDEX ? -1 : IS_SOME || IS_EVERY ? IS_EVERY : target;
      };
    }, "createMethod");
    module.exports = {
      // `Array.prototype.forEach` method
      // https://tc39.es/ecma262/#sec-array.prototype.foreach
      forEach: createMethod(0),
      // `Array.prototype.map` method
      // https://tc39.es/ecma262/#sec-array.prototype.map
      map: createMethod(1),
      // `Array.prototype.filter` method
      // https://tc39.es/ecma262/#sec-array.prototype.filter
      filter: createMethod(2),
      // `Array.prototype.some` method
      // https://tc39.es/ecma262/#sec-array.prototype.some
      some: createMethod(3),
      // `Array.prototype.every` method
      // https://tc39.es/ecma262/#sec-array.prototype.every
      every: createMethod(4),
      // `Array.prototype.find` method
      // https://tc39.es/ecma262/#sec-array.prototype.find
      find: createMethod(5),
      // `Array.prototype.findIndex` method
      // https://tc39.es/ecma262/#sec-array.prototype.findIndex
      findIndex: createMethod(6),
      // `Array.prototype.filterReject` method
      // https://github.com/tc39/proposal-array-filtering
      filterReject: createMethod(7)
    };
  }
});

// node_modules/core-js-pure/modules/es.symbol.constructor.js
var require_es_symbol_constructor = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.constructor.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $ = require_export();
    var globalThis2 = require_global_this();
    var call = require_function_call();
    var uncurryThis = require_function_uncurry_this();
    var IS_PURE = require_is_pure();
    var DESCRIPTORS = require_descriptors();
    var NATIVE_SYMBOL = require_symbol_constructor_detection();
    var fails = require_fails();
    var hasOwn = require_has_own_property();
    var isPrototypeOf = require_object_is_prototype_of();
    var anObject = require_an_object();
    var toIndexedObject = require_to_indexed_object();
    var toPropertyKey2 = require_to_property_key();
    var $toString = require_to_string();
    var createPropertyDescriptor = require_create_property_descriptor();
    var nativeObjectCreate = require_object_create();
    var objectKeys = require_object_keys();
    var getOwnPropertyNamesModule = require_object_get_own_property_names();
    var getOwnPropertyNamesExternal = require_object_get_own_property_names_external();
    var getOwnPropertySymbolsModule = require_object_get_own_property_symbols();
    var getOwnPropertyDescriptorModule = require_object_get_own_property_descriptor();
    var definePropertyModule = require_object_define_property();
    var definePropertiesModule = require_object_define_properties();
    var propertyIsEnumerableModule = require_object_property_is_enumerable();
    var defineBuiltIn = require_define_built_in();
    var defineBuiltInAccessor = require_define_built_in_accessor();
    var shared = require_shared();
    var sharedKey = require_shared_key();
    var hiddenKeys = require_hidden_keys();
    var uid = require_uid();
    var wellKnownSymbol = require_well_known_symbol();
    var wrappedWellKnownSymbolModule = require_well_known_symbol_wrapped();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    var defineSymbolToPrimitive = require_symbol_define_to_primitive();
    var setToStringTag = require_set_to_string_tag();
    var InternalStateModule = require_internal_state();
    var $forEach = require_array_iteration().forEach;
    var HIDDEN = sharedKey("hidden");
    var SYMBOL = "Symbol";
    var PROTOTYPE = "prototype";
    var setInternalState = InternalStateModule.set;
    var getInternalState = InternalStateModule.getterFor(SYMBOL);
    var ObjectPrototype = Object[PROTOTYPE];
    var $Symbol = globalThis2.Symbol;
    var SymbolPrototype = $Symbol && $Symbol[PROTOTYPE];
    var RangeError2 = globalThis2.RangeError;
    var TypeError2 = globalThis2.TypeError;
    var QObject = globalThis2.QObject;
    var nativeGetOwnPropertyDescriptor = getOwnPropertyDescriptorModule.f;
    var nativeDefineProperty = definePropertyModule.f;
    var nativeGetOwnPropertyNames = getOwnPropertyNamesExternal.f;
    var nativePropertyIsEnumerable = propertyIsEnumerableModule.f;
    var push = uncurryThis([].push);
    var AllSymbols = shared("symbols");
    var ObjectPrototypeSymbols = shared("op-symbols");
    var WellKnownSymbolsStore = shared("wks");
    var USE_SETTER = !QObject || !QObject[PROTOTYPE] || !QObject[PROTOTYPE].findChild;
    var fallbackDefineProperty = /* @__PURE__ */ __name(function(O, P, Attributes) {
      var ObjectPrototypeDescriptor = nativeGetOwnPropertyDescriptor(ObjectPrototype, P);
      if (ObjectPrototypeDescriptor) delete ObjectPrototype[P];
      nativeDefineProperty(O, P, Attributes);
      if (ObjectPrototypeDescriptor && O !== ObjectPrototype) {
        nativeDefineProperty(ObjectPrototype, P, ObjectPrototypeDescriptor);
      }
      return O;
    }, "fallbackDefineProperty");
    var setSymbolDescriptor = DESCRIPTORS && fails(function() {
      return nativeObjectCreate(nativeDefineProperty({}, "a", {
        get: /* @__PURE__ */ __name(function() {
          return nativeDefineProperty(this, "a", { value: 7 }).a;
        }, "get")
      })).a !== 7;
    }) ? fallbackDefineProperty : nativeDefineProperty;
    var wrap = /* @__PURE__ */ __name(function(tag2, description) {
      var symbol = AllSymbols[tag2] = nativeObjectCreate(SymbolPrototype);
      setInternalState(symbol, {
        type: SYMBOL,
        tag: tag2,
        description
      });
      if (!DESCRIPTORS) symbol.description = description;
      return symbol;
    }, "wrap");
    var $defineProperty = /* @__PURE__ */ __name(function defineProperty(O, P, Attributes) {
      if (O === ObjectPrototype) $defineProperty(ObjectPrototypeSymbols, P, Attributes);
      anObject(O);
      var key = toPropertyKey2(P);
      anObject(Attributes);
      if (hasOwn(AllSymbols, key)) {
        if (!("enumerable" in Attributes) ? !hasOwn(O, key) || hasOwn(O, HIDDEN) && O[HIDDEN][key] : !Attributes.enumerable) {
          if (!hasOwn(O, HIDDEN)) nativeDefineProperty(O, HIDDEN, createPropertyDescriptor(1, nativeObjectCreate(null)));
          O[HIDDEN][key] = true;
        } else {
          if (hasOwn(O, HIDDEN) && O[HIDDEN][key]) O[HIDDEN][key] = false;
          Attributes = nativeObjectCreate(Attributes, { enumerable: createPropertyDescriptor(0, false) });
        }
        return setSymbolDescriptor(O, key, Attributes);
      }
      return nativeDefineProperty(O, key, Attributes);
    }, "defineProperty");
    var $defineProperties = /* @__PURE__ */ __name(function defineProperties(O, Properties) {
      anObject(O);
      var properties = toIndexedObject(Properties);
      var keys = objectKeys(properties).concat($getOwnPropertySymbols(properties));
      $forEach(keys, function(key) {
        if (!DESCRIPTORS || call($propertyIsEnumerable, properties, key)) $defineProperty(O, key, properties[key]);
      });
      return O;
    }, "defineProperties");
    var $create = /* @__PURE__ */ __name(function create(O, Properties) {
      return Properties === void 0 ? nativeObjectCreate(O) : $defineProperties(nativeObjectCreate(O), Properties);
    }, "create");
    var $propertyIsEnumerable = /* @__PURE__ */ __name(function propertyIsEnumerable(V) {
      var P = toPropertyKey2(V);
      var enumerable = call(nativePropertyIsEnumerable, this, P);
      if (this === ObjectPrototype && hasOwn(AllSymbols, P) && !hasOwn(ObjectPrototypeSymbols, P)) return false;
      return enumerable || !hasOwn(this, P) || !hasOwn(AllSymbols, P) || hasOwn(this, HIDDEN) && this[HIDDEN][P] ? enumerable : true;
    }, "propertyIsEnumerable");
    var $getOwnPropertyDescriptor = /* @__PURE__ */ __name(function getOwnPropertyDescriptor(O, P) {
      var it = toIndexedObject(O);
      var key = toPropertyKey2(P);
      if (it === ObjectPrototype && hasOwn(AllSymbols, key) && !hasOwn(ObjectPrototypeSymbols, key)) return;
      var descriptor = nativeGetOwnPropertyDescriptor(it, key);
      if (descriptor && hasOwn(AllSymbols, key) && !(hasOwn(it, HIDDEN) && it[HIDDEN][key])) {
        descriptor.enumerable = true;
      }
      return descriptor;
    }, "getOwnPropertyDescriptor");
    var $getOwnPropertyNames = /* @__PURE__ */ __name(function getOwnPropertyNames(O) {
      var names = nativeGetOwnPropertyNames(toIndexedObject(O));
      var result = [];
      $forEach(names, function(key) {
        if (!hasOwn(AllSymbols, key) && !hasOwn(hiddenKeys, key)) push(result, key);
      });
      return result;
    }, "getOwnPropertyNames");
    var $getOwnPropertySymbols = /* @__PURE__ */ __name(function(O) {
      var IS_OBJECT_PROTOTYPE = O === ObjectPrototype;
      var names = nativeGetOwnPropertyNames(IS_OBJECT_PROTOTYPE ? ObjectPrototypeSymbols : toIndexedObject(O));
      var result = [];
      $forEach(names, function(key) {
        if (hasOwn(AllSymbols, key) && (!IS_OBJECT_PROTOTYPE || hasOwn(ObjectPrototype, key))) {
          push(result, AllSymbols[key]);
        }
      });
      return result;
    }, "$getOwnPropertySymbols");
    if (!NATIVE_SYMBOL) {
      $Symbol = /* @__PURE__ */ __name(function Symbol2() {
        if (isPrototypeOf(SymbolPrototype, this)) throw new TypeError2("Symbol is not a constructor");
        var description = !arguments.length || arguments[0] === void 0 ? void 0 : $toString(arguments[0]);
        var tag2 = uid(description);
        var setter = /* @__PURE__ */ __name(function(value) {
          var $this = this === void 0 ? globalThis2 : this;
          if ($this === ObjectPrototype) call(setter, ObjectPrototypeSymbols, value);
          if (hasOwn($this, HIDDEN) && hasOwn($this[HIDDEN], tag2)) $this[HIDDEN][tag2] = false;
          var descriptor = createPropertyDescriptor(1, value);
          try {
            setSymbolDescriptor($this, tag2, descriptor);
          } catch (error3) {
            if (!(error3 instanceof RangeError2)) throw error3;
            fallbackDefineProperty($this, tag2, descriptor);
          }
        }, "setter");
        if (DESCRIPTORS && USE_SETTER) setSymbolDescriptor(ObjectPrototype, tag2, { configurable: true, set: setter });
        return wrap(tag2, description);
      }, "Symbol");
      SymbolPrototype = $Symbol[PROTOTYPE];
      defineBuiltIn(SymbolPrototype, "toString", /* @__PURE__ */ __name(function toString() {
        return getInternalState(this).tag;
      }, "toString"));
      defineBuiltIn($Symbol, "withoutSetter", function(description) {
        return wrap(uid(description), description);
      });
      propertyIsEnumerableModule.f = $propertyIsEnumerable;
      definePropertyModule.f = $defineProperty;
      definePropertiesModule.f = $defineProperties;
      getOwnPropertyDescriptorModule.f = $getOwnPropertyDescriptor;
      getOwnPropertyNamesModule.f = getOwnPropertyNamesExternal.f = $getOwnPropertyNames;
      getOwnPropertySymbolsModule.f = $getOwnPropertySymbols;
      wrappedWellKnownSymbolModule.f = function(name) {
        return wrap(wellKnownSymbol(name), name);
      };
      if (DESCRIPTORS) {
        defineBuiltInAccessor(SymbolPrototype, "description", {
          configurable: true,
          get: /* @__PURE__ */ __name(function description() {
            return getInternalState(this).description;
          }, "description")
        });
        if (!IS_PURE) {
          defineBuiltIn(ObjectPrototype, "propertyIsEnumerable", $propertyIsEnumerable, { unsafe: true });
        }
      }
    }
    $({ global: true, constructor: true, wrap: true, forced: !NATIVE_SYMBOL, sham: !NATIVE_SYMBOL }, {
      Symbol: $Symbol
    });
    $forEach(objectKeys(WellKnownSymbolsStore), function(name) {
      defineWellKnownSymbol(name);
    });
    $({ target: SYMBOL, stat: true, forced: !NATIVE_SYMBOL }, {
      useSetter: /* @__PURE__ */ __name(function() {
        USE_SETTER = true;
      }, "useSetter"),
      useSimple: /* @__PURE__ */ __name(function() {
        USE_SETTER = false;
      }, "useSimple")
    });
    $({ target: "Object", stat: true, forced: !NATIVE_SYMBOL, sham: !DESCRIPTORS }, {
      // `Object.create` method
      // https://tc39.es/ecma262/#sec-object.create
      create: $create,
      // `Object.defineProperty` method
      // https://tc39.es/ecma262/#sec-object.defineproperty
      defineProperty: $defineProperty,
      // `Object.defineProperties` method
      // https://tc39.es/ecma262/#sec-object.defineproperties
      defineProperties: $defineProperties,
      // `Object.getOwnPropertyDescriptor` method
      // https://tc39.es/ecma262/#sec-object.getownpropertydescriptors
      getOwnPropertyDescriptor: $getOwnPropertyDescriptor
    });
    $({ target: "Object", stat: true, forced: !NATIVE_SYMBOL }, {
      // `Object.getOwnPropertyNames` method
      // https://tc39.es/ecma262/#sec-object.getownpropertynames
      getOwnPropertyNames: $getOwnPropertyNames
    });
    defineSymbolToPrimitive();
    setToStringTag($Symbol, SYMBOL);
    hiddenKeys[HIDDEN] = true;
  }
});

// node_modules/core-js-pure/internals/symbol-registry-detection.js
var require_symbol_registry_detection = __commonJS({
  "node_modules/core-js-pure/internals/symbol-registry-detection.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var NATIVE_SYMBOL = require_symbol_constructor_detection();
    module.exports = NATIVE_SYMBOL && !!Symbol["for"] && !!Symbol.keyFor;
  }
});

// node_modules/core-js-pure/modules/es.symbol.for.js
var require_es_symbol_for = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.for.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $ = require_export();
    var getBuiltIn = require_get_built_in();
    var hasOwn = require_has_own_property();
    var toString = require_to_string();
    var shared = require_shared();
    var NATIVE_SYMBOL_REGISTRY = require_symbol_registry_detection();
    var StringToSymbolRegistry = shared("string-to-symbol-registry");
    var SymbolToStringRegistry = shared("symbol-to-string-registry");
    $({ target: "Symbol", stat: true, forced: !NATIVE_SYMBOL_REGISTRY }, {
      "for": /* @__PURE__ */ __name(function(key) {
        var string = toString(key);
        if (hasOwn(StringToSymbolRegistry, string)) return StringToSymbolRegistry[string];
        var symbol = getBuiltIn("Symbol")(string);
        StringToSymbolRegistry[string] = symbol;
        SymbolToStringRegistry[symbol] = string;
        return symbol;
      }, "for")
    });
  }
});

// node_modules/core-js-pure/modules/es.symbol.key-for.js
var require_es_symbol_key_for = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.key-for.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $ = require_export();
    var hasOwn = require_has_own_property();
    var isSymbol = require_is_symbol();
    var tryToString = require_try_to_string();
    var shared = require_shared();
    var NATIVE_SYMBOL_REGISTRY = require_symbol_registry_detection();
    var SymbolToStringRegistry = shared("symbol-to-string-registry");
    $({ target: "Symbol", stat: true, forced: !NATIVE_SYMBOL_REGISTRY }, {
      keyFor: /* @__PURE__ */ __name(function keyFor(sym) {
        if (!isSymbol(sym)) throw new TypeError(tryToString(sym) + " is not a symbol");
        if (hasOwn(SymbolToStringRegistry, sym)) return SymbolToStringRegistry[sym];
      }, "keyFor")
    });
  }
});

// node_modules/core-js-pure/internals/is-raw-json.js
var require_is_raw_json = __commonJS({
  "node_modules/core-js-pure/internals/is-raw-json.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var isObject2 = require_is_object();
    var getInternalState = require_internal_state().get;
    module.exports = /* @__PURE__ */ __name(function isRawJSON(O) {
      if (!isObject2(O)) return false;
      var state = getInternalState(O);
      return !!state && state.type === "RawJSON";
    }, "isRawJSON");
  }
});

// node_modules/core-js-pure/internals/parse-json-string.js
var require_parse_json_string = __commonJS({
  "node_modules/core-js-pure/internals/parse-json-string.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this();
    var hasOwn = require_has_own_property();
    var $SyntaxError = SyntaxError;
    var $parseInt = parseInt;
    var fromCharCode = String.fromCharCode;
    var at = uncurryThis("".charAt);
    var slice = uncurryThis("".slice);
    var exec = uncurryThis(/./.exec);
    var codePoints = {
      '\\"': '"',
      "\\\\": "\\",
      "\\/": "/",
      "\\b": "\b",
      "\\f": "\f",
      "\\n": "\n",
      "\\r": "\r",
      "\\t": "	"
    };
    var IS_4_HEX_DIGITS = /^[\da-f]{4}$/i;
    var IS_C0_CONTROL_CODE = /^[\u0000-\u001F]$/;
    module.exports = function(source, i2) {
      var unterminated = true;
      var value = "";
      while (i2 < source.length) {
        var chr = at(source, i2);
        if (chr === "\\") {
          var twoChars = slice(source, i2, i2 + 2);
          if (hasOwn(codePoints, twoChars)) {
            value += codePoints[twoChars];
            i2 += 2;
          } else if (twoChars === "\\u") {
            i2 += 2;
            var fourHexDigits = slice(source, i2, i2 + 4);
            if (!exec(IS_4_HEX_DIGITS, fourHexDigits)) throw new $SyntaxError("Bad Unicode escape at: " + i2);
            value += fromCharCode($parseInt(fourHexDigits, 16));
            i2 += 4;
          } else throw new $SyntaxError('Unknown escape sequence: "' + twoChars + '"');
        } else if (chr === '"') {
          unterminated = false;
          i2++;
          break;
        } else {
          if (exec(IS_C0_CONTROL_CODE, chr)) throw new $SyntaxError("Bad control character in string literal at: " + i2);
          value += chr;
          i2++;
        }
      }
      if (unterminated) throw new $SyntaxError("Unterminated string at: " + i2);
      return { value, end: i2 };
    };
  }
});

// node_modules/core-js-pure/internals/native-raw-json.js
var require_native_raw_json = __commonJS({
  "node_modules/core-js-pure/internals/native-raw-json.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var fails = require_fails();
    module.exports = !fails(function() {
      var unsafeInt = "9007199254740993";
      var raw2 = JSON.rawJSON(unsafeInt);
      return !JSON.isRawJSON(raw2) || JSON.stringify(raw2) !== unsafeInt;
    });
  }
});

// node_modules/core-js-pure/modules/es.json.stringify.js
var require_es_json_stringify = __commonJS({
  "node_modules/core-js-pure/modules/es.json.stringify.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $ = require_export();
    var getBuiltIn = require_get_built_in();
    var apply = require_function_apply();
    var call = require_function_call();
    var uncurryThis = require_function_uncurry_this();
    var fails = require_fails();
    var isArray = require_is_array();
    var isCallable = require_is_callable();
    var isRawJSON = require_is_raw_json();
    var isSymbol = require_is_symbol();
    var classof = require_classof_raw();
    var toString = require_to_string();
    var arraySlice = require_array_slice();
    var parseJSONString = require_parse_json_string();
    var uid = require_uid();
    var NATIVE_SYMBOL = require_symbol_constructor_detection();
    var NATIVE_RAW_JSON = require_native_raw_json();
    var $String = String;
    var $stringify = getBuiltIn("JSON", "stringify");
    var exec = uncurryThis(/./.exec);
    var charAt = uncurryThis("".charAt);
    var charCodeAt = uncurryThis("".charCodeAt);
    var replace = uncurryThis("".replace);
    var slice = uncurryThis("".slice);
    var push = uncurryThis([].push);
    var numberToString = uncurryThis(1.1.toString);
    var surrogates = /[\uD800-\uDFFF]/g;
    var leadingSurrogates = /^[\uD800-\uDBFF]$/;
    var trailingSurrogates = /^[\uDC00-\uDFFF]$/;
    var MARK = uid();
    var MARK_LENGTH = MARK.length;
    var WRONG_SYMBOLS_CONVERSION = !NATIVE_SYMBOL || fails(function() {
      var symbol = getBuiltIn("Symbol")("stringify detection");
      return $stringify([symbol]) !== "[null]" || $stringify({ a: symbol }) !== "{}" || $stringify(Object(symbol)) !== "{}";
    });
    var ILL_FORMED_UNICODE = fails(function() {
      return $stringify("\uDF06\uD834") !== '"\\udf06\\ud834"' || $stringify("\uDEAD") !== '"\\udead"';
    });
    var stringifyWithProperSymbolsConversion = WRONG_SYMBOLS_CONVERSION ? function(it, replacer) {
      var args = arraySlice(arguments);
      var $replacer = getReplacerFunction(replacer);
      if (!isCallable($replacer) && (it === void 0 || isSymbol(it))) return;
      args[1] = function(key, value) {
        if (isCallable($replacer)) value = call($replacer, this, $String(key), value);
        if (!isSymbol(value)) return value;
      };
      return apply($stringify, null, args);
    } : $stringify;
    var fixIllFormedJSON = /* @__PURE__ */ __name(function(match2, offset, string) {
      var prev = charAt(string, offset - 1);
      var next = charAt(string, offset + 1);
      if (exec(leadingSurrogates, match2) && !exec(trailingSurrogates, next) || exec(trailingSurrogates, match2) && !exec(leadingSurrogates, prev)) {
        return "\\u" + numberToString(charCodeAt(match2, 0), 16);
      }
      return match2;
    }, "fixIllFormedJSON");
    var getReplacerFunction = /* @__PURE__ */ __name(function(replacer) {
      if (isCallable(replacer)) return replacer;
      if (!isArray(replacer)) return;
      var rawLength = replacer.length;
      var keys = [];
      for (var i2 = 0; i2 < rawLength; i2++) {
        var element = replacer[i2];
        if (typeof element == "string") push(keys, element);
        else if (typeof element == "number" || classof(element) === "Number" || classof(element) === "String") push(keys, toString(element));
      }
      var keysLength = keys.length;
      var root = true;
      return function(key, value) {
        if (root) {
          root = false;
          return value;
        }
        if (isArray(this)) return value;
        for (var j = 0; j < keysLength; j++) if (keys[j] === key) return value;
      };
    }, "getReplacerFunction");
    if ($stringify) $({ target: "JSON", stat: true, arity: 3, forced: WRONG_SYMBOLS_CONVERSION || ILL_FORMED_UNICODE || !NATIVE_RAW_JSON }, {
      stringify: /* @__PURE__ */ __name(function stringify(text, replacer, space) {
        var replacerFunction = getReplacerFunction(replacer);
        var rawStrings = [];
        var json = stringifyWithProperSymbolsConversion(text, function(key, value) {
          var v = isCallable(replacerFunction) ? call(replacerFunction, this, $String(key), value) : value;
          return !NATIVE_RAW_JSON && isRawJSON(v) ? MARK + (push(rawStrings, v.rawJSON) - 1) : v;
        }, space);
        if (typeof json != "string") return json;
        if (ILL_FORMED_UNICODE) json = replace(json, surrogates, fixIllFormedJSON);
        if (NATIVE_RAW_JSON) return json;
        var result = "";
        var length = json.length;
        for (var i2 = 0; i2 < length; i2++) {
          var chr = charAt(json, i2);
          if (chr === '"') {
            var end = parseJSONString(json, ++i2).end - 1;
            var string = slice(json, i2, end);
            result += slice(string, 0, MARK_LENGTH) === MARK ? rawStrings[slice(string, MARK_LENGTH)] : '"' + string + '"';
            i2 = end;
          } else result += chr;
        }
        return result;
      }, "stringify")
    });
  }
});

// node_modules/core-js-pure/modules/es.object.get-own-property-symbols.js
var require_es_object_get_own_property_symbols = __commonJS({
  "node_modules/core-js-pure/modules/es.object.get-own-property-symbols.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $ = require_export();
    var NATIVE_SYMBOL = require_symbol_constructor_detection();
    var fails = require_fails();
    var getOwnPropertySymbolsModule = require_object_get_own_property_symbols();
    var toObject = require_to_object();
    var FORCED = !NATIVE_SYMBOL || fails(function() {
      getOwnPropertySymbolsModule.f(1);
    });
    $({ target: "Object", stat: true, forced: FORCED }, {
      getOwnPropertySymbols: /* @__PURE__ */ __name(function getOwnPropertySymbols(it) {
        var $getOwnPropertySymbols = getOwnPropertySymbolsModule.f;
        return $getOwnPropertySymbols ? $getOwnPropertySymbols(toObject(it)) : [];
      }, "getOwnPropertySymbols")
    });
  }
});

// node_modules/core-js-pure/modules/es.symbol.js
var require_es_symbol = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    require_es_symbol_constructor();
    require_es_symbol_for();
    require_es_symbol_key_for();
    require_es_json_stringify();
    require_es_object_get_own_property_symbols();
  }
});

// node_modules/core-js-pure/modules/es.symbol.async-dispose.js
var require_es_symbol_async_dispose = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.async-dispose.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("asyncDispose");
  }
});

// node_modules/core-js-pure/modules/es.symbol.async-iterator.js
var require_es_symbol_async_iterator = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.async-iterator.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("asyncIterator");
  }
});

// node_modules/core-js-pure/modules/es.symbol.description.js
var require_es_symbol_description = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.description.js"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
  }
});

// node_modules/core-js-pure/modules/es.symbol.dispose.js
var require_es_symbol_dispose = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.dispose.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("dispose");
  }
});

// node_modules/core-js-pure/modules/es.symbol.has-instance.js
var require_es_symbol_has_instance = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.has-instance.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("hasInstance");
  }
});

// node_modules/core-js-pure/modules/es.symbol.is-concat-spreadable.js
var require_es_symbol_is_concat_spreadable = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.is-concat-spreadable.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("isConcatSpreadable");
  }
});

// node_modules/core-js-pure/modules/es.symbol.iterator.js
var require_es_symbol_iterator = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.iterator.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("iterator");
  }
});

// node_modules/core-js-pure/modules/es.symbol.match.js
var require_es_symbol_match = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.match.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("match");
  }
});

// node_modules/core-js-pure/modules/es.symbol.match-all.js
var require_es_symbol_match_all = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.match-all.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("matchAll");
  }
});

// node_modules/core-js-pure/modules/es.symbol.replace.js
var require_es_symbol_replace = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.replace.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("replace");
  }
});

// node_modules/core-js-pure/modules/es.symbol.search.js
var require_es_symbol_search = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.search.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("search");
  }
});

// node_modules/core-js-pure/modules/es.symbol.species.js
var require_es_symbol_species = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.species.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("species");
  }
});

// node_modules/core-js-pure/modules/es.symbol.split.js
var require_es_symbol_split = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.split.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("split");
  }
});

// node_modules/core-js-pure/modules/es.symbol.to-primitive.js
var require_es_symbol_to_primitive = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.to-primitive.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    var defineSymbolToPrimitive = require_symbol_define_to_primitive();
    defineWellKnownSymbol("toPrimitive");
    defineSymbolToPrimitive();
  }
});

// node_modules/core-js-pure/modules/es.symbol.to-string-tag.js
var require_es_symbol_to_string_tag = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.to-string-tag.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var getBuiltIn = require_get_built_in();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    var setToStringTag = require_set_to_string_tag();
    defineWellKnownSymbol("toStringTag");
    setToStringTag(getBuiltIn("Symbol"), "Symbol");
  }
});

// node_modules/core-js-pure/modules/es.symbol.unscopables.js
var require_es_symbol_unscopables = __commonJS({
  "node_modules/core-js-pure/modules/es.symbol.unscopables.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("unscopables");
  }
});

// node_modules/core-js-pure/modules/es.json.to-string-tag.js
var require_es_json_to_string_tag = __commonJS({
  "node_modules/core-js-pure/modules/es.json.to-string-tag.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var globalThis2 = require_global_this();
    var setToStringTag = require_set_to_string_tag();
    setToStringTag(globalThis2.JSON, "JSON", true);
  }
});

// node_modules/core-js-pure/modules/es.math.to-string-tag.js
var require_es_math_to_string_tag = __commonJS({
  "node_modules/core-js-pure/modules/es.math.to-string-tag.js"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
  }
});

// node_modules/core-js-pure/modules/es.reflect.to-string-tag.js
var require_es_reflect_to_string_tag = __commonJS({
  "node_modules/core-js-pure/modules/es.reflect.to-string-tag.js"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
  }
});

// node_modules/core-js-pure/es/symbol/index.js
var require_symbol = __commonJS({
  "node_modules/core-js-pure/es/symbol/index.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    require_es_array_concat();
    require_es_object_to_string();
    require_es_symbol();
    require_es_symbol_async_dispose();
    require_es_symbol_async_iterator();
    require_es_symbol_description();
    require_es_symbol_dispose();
    require_es_symbol_has_instance();
    require_es_symbol_is_concat_spreadable();
    require_es_symbol_iterator();
    require_es_symbol_match();
    require_es_symbol_match_all();
    require_es_symbol_replace();
    require_es_symbol_search();
    require_es_symbol_species();
    require_es_symbol_split();
    require_es_symbol_to_primitive();
    require_es_symbol_to_string_tag();
    require_es_symbol_unscopables();
    require_es_json_to_string_tag();
    require_es_math_to_string_tag();
    require_es_reflect_to_string_tag();
    var path = require_path();
    module.exports = path.Symbol;
  }
});

// node_modules/core-js-pure/internals/add-to-unscopables.js
var require_add_to_unscopables = __commonJS({
  "node_modules/core-js-pure/internals/add-to-unscopables.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = function() {
    };
  }
});

// node_modules/core-js-pure/internals/iterators.js
var require_iterators = __commonJS({
  "node_modules/core-js-pure/internals/iterators.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = {};
  }
});

// node_modules/core-js-pure/internals/function-name.js
var require_function_name = __commonJS({
  "node_modules/core-js-pure/internals/function-name.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var DESCRIPTORS = require_descriptors();
    var hasOwn = require_has_own_property();
    var FunctionPrototype = Function.prototype;
    var getDescriptor = DESCRIPTORS && Object.getOwnPropertyDescriptor;
    var EXISTS = hasOwn(FunctionPrototype, "name");
    var PROPER = EXISTS && (/* @__PURE__ */ __name(function something() {
    }, "something")).name === "something";
    var CONFIGURABLE = EXISTS && (!DESCRIPTORS || DESCRIPTORS && getDescriptor(FunctionPrototype, "name").configurable);
    module.exports = {
      EXISTS,
      PROPER,
      CONFIGURABLE
    };
  }
});

// node_modules/core-js-pure/internals/correct-prototype-getter.js
var require_correct_prototype_getter = __commonJS({
  "node_modules/core-js-pure/internals/correct-prototype-getter.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var fails = require_fails();
    module.exports = !fails(function() {
      function F() {
      }
      __name(F, "F");
      F.prototype.constructor = null;
      return Object.getPrototypeOf(new F()) !== F.prototype;
    });
  }
});

// node_modules/core-js-pure/internals/object-get-prototype-of.js
var require_object_get_prototype_of = __commonJS({
  "node_modules/core-js-pure/internals/object-get-prototype-of.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var hasOwn = require_has_own_property();
    var isCallable = require_is_callable();
    var toObject = require_to_object();
    var sharedKey = require_shared_key();
    var CORRECT_PROTOTYPE_GETTER = require_correct_prototype_getter();
    var IE_PROTO = sharedKey("IE_PROTO");
    var $Object = Object;
    var ObjectPrototype = $Object.prototype;
    module.exports = CORRECT_PROTOTYPE_GETTER ? $Object.getPrototypeOf : function(O) {
      var object = toObject(O);
      if (hasOwn(object, IE_PROTO)) return object[IE_PROTO];
      var constructor = object.constructor;
      if (isCallable(constructor) && object instanceof constructor) {
        return constructor.prototype;
      }
      return object instanceof $Object ? ObjectPrototype : null;
    };
  }
});

// node_modules/core-js-pure/internals/iterators-core.js
var require_iterators_core = __commonJS({
  "node_modules/core-js-pure/internals/iterators-core.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var fails = require_fails();
    var isCallable = require_is_callable();
    var isObject2 = require_is_object();
    var create = require_object_create();
    var getPrototypeOf = require_object_get_prototype_of();
    var defineBuiltIn = require_define_built_in();
    var wellKnownSymbol = require_well_known_symbol();
    var IS_PURE = require_is_pure();
    var ITERATOR = wellKnownSymbol("iterator");
    var BUGGY_SAFARI_ITERATORS = false;
    var IteratorPrototype;
    var PrototypeOfArrayIteratorPrototype;
    var arrayIterator;
    if ([].keys) {
      arrayIterator = [].keys();
      if (!("next" in arrayIterator)) BUGGY_SAFARI_ITERATORS = true;
      else {
        PrototypeOfArrayIteratorPrototype = getPrototypeOf(getPrototypeOf(arrayIterator));
        if (PrototypeOfArrayIteratorPrototype !== Object.prototype) IteratorPrototype = PrototypeOfArrayIteratorPrototype;
      }
    }
    var NEW_ITERATOR_PROTOTYPE = !isObject2(IteratorPrototype) || fails(function() {
      var test = {};
      return IteratorPrototype[ITERATOR].call(test) !== test;
    });
    if (NEW_ITERATOR_PROTOTYPE) IteratorPrototype = {};
    else if (IS_PURE) IteratorPrototype = create(IteratorPrototype);
    if (!isCallable(IteratorPrototype[ITERATOR])) {
      defineBuiltIn(IteratorPrototype, ITERATOR, function() {
        return this;
      });
    }
    module.exports = {
      IteratorPrototype,
      BUGGY_SAFARI_ITERATORS
    };
  }
});

// node_modules/core-js-pure/internals/iterator-create-constructor.js
var require_iterator_create_constructor = __commonJS({
  "node_modules/core-js-pure/internals/iterator-create-constructor.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var IteratorPrototype = require_iterators_core().IteratorPrototype;
    var create = require_object_create();
    var createPropertyDescriptor = require_create_property_descriptor();
    var setToStringTag = require_set_to_string_tag();
    var Iterators = require_iterators();
    var returnThis = /* @__PURE__ */ __name(function() {
      return this;
    }, "returnThis");
    module.exports = function(IteratorConstructor, NAME, next, ENUMERABLE_NEXT) {
      var TO_STRING_TAG = NAME + " Iterator";
      IteratorConstructor.prototype = create(IteratorPrototype, { next: createPropertyDescriptor(+!ENUMERABLE_NEXT, next) });
      setToStringTag(IteratorConstructor, TO_STRING_TAG, false, true);
      Iterators[TO_STRING_TAG] = returnThis;
      return IteratorConstructor;
    };
  }
});

// node_modules/core-js-pure/internals/function-uncurry-this-accessor.js
var require_function_uncurry_this_accessor = __commonJS({
  "node_modules/core-js-pure/internals/function-uncurry-this-accessor.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this();
    var aCallable = require_a_callable();
    module.exports = function(object, key, method) {
      try {
        return uncurryThis(aCallable(Object.getOwnPropertyDescriptor(object, key)[method]));
      } catch (error3) {
      }
    };
  }
});

// node_modules/core-js-pure/internals/is-possible-prototype.js
var require_is_possible_prototype = __commonJS({
  "node_modules/core-js-pure/internals/is-possible-prototype.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var isObject2 = require_is_object();
    module.exports = function(argument) {
      return isObject2(argument) || argument === null;
    };
  }
});

// node_modules/core-js-pure/internals/a-possible-prototype.js
var require_a_possible_prototype = __commonJS({
  "node_modules/core-js-pure/internals/a-possible-prototype.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var isPossiblePrototype = require_is_possible_prototype();
    var $String = String;
    var $TypeError = TypeError;
    module.exports = function(argument) {
      if (isPossiblePrototype(argument)) return argument;
      throw new $TypeError("Can't set " + $String(argument) + " as a prototype");
    };
  }
});

// node_modules/core-js-pure/internals/object-set-prototype-of.js
var require_object_set_prototype_of = __commonJS({
  "node_modules/core-js-pure/internals/object-set-prototype-of.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThisAccessor = require_function_uncurry_this_accessor();
    var isObject2 = require_is_object();
    var requireObjectCoercible = require_require_object_coercible();
    var aPossiblePrototype = require_a_possible_prototype();
    module.exports = Object.setPrototypeOf || ("__proto__" in {} ? (function() {
      var CORRECT_SETTER = false;
      var test = {};
      var setter;
      try {
        setter = uncurryThisAccessor(Object.prototype, "__proto__", "set");
        setter(test, []);
        CORRECT_SETTER = test instanceof Array;
      } catch (error3) {
      }
      return /* @__PURE__ */ __name(function setPrototypeOf(O, proto) {
        requireObjectCoercible(O);
        aPossiblePrototype(proto);
        if (!isObject2(O)) return O;
        if (CORRECT_SETTER) setter(O, proto);
        else O.__proto__ = proto;
        return O;
      }, "setPrototypeOf");
    })() : void 0);
  }
});

// node_modules/core-js-pure/internals/iterator-define.js
var require_iterator_define = __commonJS({
  "node_modules/core-js-pure/internals/iterator-define.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $ = require_export();
    var call = require_function_call();
    var IS_PURE = require_is_pure();
    var FunctionName = require_function_name();
    var isCallable = require_is_callable();
    var createIteratorConstructor = require_iterator_create_constructor();
    var getPrototypeOf = require_object_get_prototype_of();
    var setPrototypeOf = require_object_set_prototype_of();
    var setToStringTag = require_set_to_string_tag();
    var createNonEnumerableProperty = require_create_non_enumerable_property();
    var defineBuiltIn = require_define_built_in();
    var wellKnownSymbol = require_well_known_symbol();
    var Iterators = require_iterators();
    var IteratorsCore = require_iterators_core();
    var PROPER_FUNCTION_NAME = FunctionName.PROPER;
    var CONFIGURABLE_FUNCTION_NAME = FunctionName.CONFIGURABLE;
    var IteratorPrototype = IteratorsCore.IteratorPrototype;
    var BUGGY_SAFARI_ITERATORS = IteratorsCore.BUGGY_SAFARI_ITERATORS;
    var ITERATOR = wellKnownSymbol("iterator");
    var KEYS = "keys";
    var VALUES = "values";
    var ENTRIES = "entries";
    var returnThis = /* @__PURE__ */ __name(function() {
      return this;
    }, "returnThis");
    module.exports = function(Iterable, NAME, IteratorConstructor, next, DEFAULT, IS_SET, FORCED) {
      createIteratorConstructor(IteratorConstructor, NAME, next);
      var getIterationMethod = /* @__PURE__ */ __name(function(KIND) {
        if (KIND === DEFAULT && defaultIterator) return defaultIterator;
        if (!BUGGY_SAFARI_ITERATORS && KIND && KIND in IterablePrototype) return IterablePrototype[KIND];
        switch (KIND) {
          case KEYS:
            return /* @__PURE__ */ __name(function keys() {
              return new IteratorConstructor(this, KIND);
            }, "keys");
          case VALUES:
            return /* @__PURE__ */ __name(function values() {
              return new IteratorConstructor(this, KIND);
            }, "values");
          case ENTRIES:
            return /* @__PURE__ */ __name(function entries() {
              return new IteratorConstructor(this, KIND);
            }, "entries");
        }
        return function() {
          return new IteratorConstructor(this);
        };
      }, "getIterationMethod");
      var TO_STRING_TAG = NAME + " Iterator";
      var INCORRECT_VALUES_NAME = false;
      var IterablePrototype = Iterable.prototype;
      var nativeIterator = IterablePrototype[ITERATOR] || IterablePrototype["@@iterator"] || DEFAULT && IterablePrototype[DEFAULT];
      var defaultIterator = !BUGGY_SAFARI_ITERATORS && nativeIterator || getIterationMethod(DEFAULT);
      var anyNativeIterator = NAME === "Array" ? IterablePrototype.entries || nativeIterator : nativeIterator;
      var CurrentIteratorPrototype, methods, KEY;
      if (anyNativeIterator) {
        CurrentIteratorPrototype = getPrototypeOf(anyNativeIterator.call(new Iterable()));
        if (CurrentIteratorPrototype !== Object.prototype && CurrentIteratorPrototype.next) {
          if (!IS_PURE && getPrototypeOf(CurrentIteratorPrototype) !== IteratorPrototype) {
            if (setPrototypeOf) {
              setPrototypeOf(CurrentIteratorPrototype, IteratorPrototype);
            } else if (!isCallable(CurrentIteratorPrototype[ITERATOR])) {
              defineBuiltIn(CurrentIteratorPrototype, ITERATOR, returnThis);
            }
          }
          setToStringTag(CurrentIteratorPrototype, TO_STRING_TAG, true, true);
          if (IS_PURE) Iterators[TO_STRING_TAG] = returnThis;
        }
      }
      if (PROPER_FUNCTION_NAME && DEFAULT === VALUES && nativeIterator && nativeIterator.name !== VALUES) {
        if (!IS_PURE && CONFIGURABLE_FUNCTION_NAME) {
          createNonEnumerableProperty(IterablePrototype, "name", VALUES);
        } else {
          INCORRECT_VALUES_NAME = true;
          defaultIterator = /* @__PURE__ */ __name(function values() {
            return call(nativeIterator, this);
          }, "values");
        }
      }
      if (DEFAULT) {
        methods = {
          values: getIterationMethod(VALUES),
          keys: IS_SET ? defaultIterator : getIterationMethod(KEYS),
          entries: getIterationMethod(ENTRIES)
        };
        if (FORCED) for (KEY in methods) {
          if (BUGGY_SAFARI_ITERATORS || INCORRECT_VALUES_NAME || !(KEY in IterablePrototype)) {
            defineBuiltIn(IterablePrototype, KEY, methods[KEY]);
          }
        }
        else $({ target: NAME, proto: true, forced: BUGGY_SAFARI_ITERATORS || INCORRECT_VALUES_NAME }, methods);
      }
      if ((!IS_PURE || FORCED) && IterablePrototype[ITERATOR] !== defaultIterator) {
        defineBuiltIn(IterablePrototype, ITERATOR, defaultIterator, { name: DEFAULT });
      }
      Iterators[NAME] = defaultIterator;
      return methods;
    };
  }
});

// node_modules/core-js-pure/internals/create-iter-result-object.js
var require_create_iter_result_object = __commonJS({
  "node_modules/core-js-pure/internals/create-iter-result-object.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = function(value, done) {
      return { value, done };
    };
  }
});

// node_modules/core-js-pure/modules/es.array.iterator.js
var require_es_array_iterator = __commonJS({
  "node_modules/core-js-pure/modules/es.array.iterator.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var toIndexedObject = require_to_indexed_object();
    var addToUnscopables = require_add_to_unscopables();
    var Iterators = require_iterators();
    var InternalStateModule = require_internal_state();
    var defineProperty = require_object_define_property().f;
    var defineIterator = require_iterator_define();
    var createIterResultObject = require_create_iter_result_object();
    var IS_PURE = require_is_pure();
    var DESCRIPTORS = require_descriptors();
    var ARRAY_ITERATOR = "Array Iterator";
    var setInternalState = InternalStateModule.set;
    var getInternalState = InternalStateModule.getterFor(ARRAY_ITERATOR);
    module.exports = defineIterator(Array, "Array", function(iterated, kind) {
      setInternalState(this, {
        type: ARRAY_ITERATOR,
        target: toIndexedObject(iterated),
        // target
        index: 0,
        // next index
        kind
        // kind
      });
    }, function() {
      var state = getInternalState(this);
      var target = state.target;
      var index = state.index++;
      if (!target || index >= target.length) {
        state.target = null;
        return createIterResultObject(void 0, true);
      }
      switch (state.kind) {
        case "keys":
          return createIterResultObject(index, false);
        case "values":
          return createIterResultObject(target[index], false);
      }
      return createIterResultObject([index, target[index]], false);
    }, "values");
    var values = Iterators.Arguments = Iterators.Array;
    addToUnscopables("keys");
    addToUnscopables("values");
    addToUnscopables("entries");
    if (!IS_PURE && DESCRIPTORS && values.name !== "values") try {
      defineProperty(values, "name", { value: "values" });
    } catch (error3) {
    }
  }
});

// node_modules/core-js-pure/internals/dom-iterables.js
var require_dom_iterables = __commonJS({
  "node_modules/core-js-pure/internals/dom-iterables.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = {
      CSSRuleList: 0,
      CSSStyleDeclaration: 0,
      CSSValueList: 0,
      ClientRectList: 0,
      DOMRectList: 0,
      DOMStringList: 0,
      DOMTokenList: 1,
      DataTransferItemList: 0,
      FileList: 0,
      HTMLAllCollection: 0,
      HTMLCollection: 0,
      HTMLFormElement: 0,
      HTMLSelectElement: 0,
      MediaList: 0,
      MimeTypeArray: 0,
      NamedNodeMap: 0,
      NodeList: 1,
      PaintRequestList: 0,
      Plugin: 0,
      PluginArray: 0,
      SVGLengthList: 0,
      SVGNumberList: 0,
      SVGPathSegList: 0,
      SVGPointList: 0,
      SVGStringList: 0,
      SVGTransformList: 0,
      SourceBufferList: 0,
      StyleSheetList: 0,
      TextTrackCueList: 0,
      TextTrackList: 0,
      TouchList: 0
    };
  }
});

// node_modules/core-js-pure/modules/web.dom-collections.iterator.js
var require_web_dom_collections_iterator = __commonJS({
  "node_modules/core-js-pure/modules/web.dom-collections.iterator.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    require_es_array_iterator();
    var DOMIterables = require_dom_iterables();
    var globalThis2 = require_global_this();
    var setToStringTag = require_set_to_string_tag();
    var Iterators = require_iterators();
    for (COLLECTION_NAME in DOMIterables) {
      setToStringTag(globalThis2[COLLECTION_NAME], COLLECTION_NAME);
      Iterators[COLLECTION_NAME] = Iterators.Array;
    }
    var COLLECTION_NAME;
  }
});

// node_modules/core-js-pure/stable/symbol/index.js
var require_symbol2 = __commonJS({
  "node_modules/core-js-pure/stable/symbol/index.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_symbol();
    require_web_dom_collections_iterator();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/modules/esnext.function.metadata.js
var require_esnext_function_metadata = __commonJS({
  "node_modules/core-js-pure/modules/esnext.function.metadata.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var wellKnownSymbol = require_well_known_symbol();
    var defineProperty = require_object_define_property().f;
    var METADATA = wellKnownSymbol("metadata");
    var FunctionPrototype = Function.prototype;
    if (FunctionPrototype[METADATA] === void 0) {
      defineProperty(FunctionPrototype, METADATA, {
        value: null
      });
    }
  }
});

// node_modules/core-js-pure/modules/esnext.symbol.async-dispose.js
var require_esnext_symbol_async_dispose = __commonJS({
  "node_modules/core-js-pure/modules/esnext.symbol.async-dispose.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    require_es_symbol_async_dispose();
  }
});

// node_modules/core-js-pure/modules/esnext.symbol.dispose.js
var require_esnext_symbol_dispose = __commonJS({
  "node_modules/core-js-pure/modules/esnext.symbol.dispose.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    require_es_symbol_dispose();
  }
});

// node_modules/core-js-pure/modules/esnext.symbol.metadata.js
var require_esnext_symbol_metadata = __commonJS({
  "node_modules/core-js-pure/modules/esnext.symbol.metadata.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("metadata");
  }
});

// node_modules/core-js-pure/actual/symbol/index.js
var require_symbol3 = __commonJS({
  "node_modules/core-js-pure/actual/symbol/index.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_symbol2();
    require_esnext_function_metadata();
    require_esnext_symbol_async_dispose();
    require_esnext_symbol_dispose();
    require_esnext_symbol_metadata();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/internals/symbol-is-registered.js
var require_symbol_is_registered = __commonJS({
  "node_modules/core-js-pure/internals/symbol-is-registered.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var getBuiltIn = require_get_built_in();
    var uncurryThis = require_function_uncurry_this();
    var Symbol2 = getBuiltIn("Symbol");
    var keyFor = Symbol2.keyFor;
    var thisSymbolValue = uncurryThis(Symbol2.prototype.valueOf);
    module.exports = Symbol2.isRegisteredSymbol || /* @__PURE__ */ __name(function isRegisteredSymbol(value) {
      try {
        return keyFor(thisSymbolValue(value)) !== void 0;
      } catch (error3) {
        return false;
      }
    }, "isRegisteredSymbol");
  }
});

// node_modules/core-js-pure/modules/esnext.symbol.is-registered-symbol.js
var require_esnext_symbol_is_registered_symbol = __commonJS({
  "node_modules/core-js-pure/modules/esnext.symbol.is-registered-symbol.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $ = require_export();
    var isRegisteredSymbol = require_symbol_is_registered();
    $({ target: "Symbol", stat: true }, {
      isRegisteredSymbol
    });
  }
});

// node_modules/core-js-pure/internals/symbol-is-well-known.js
var require_symbol_is_well_known = __commonJS({
  "node_modules/core-js-pure/internals/symbol-is-well-known.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var shared = require_shared();
    var getBuiltIn = require_get_built_in();
    var uncurryThis = require_function_uncurry_this();
    var isSymbol = require_is_symbol();
    var wellKnownSymbol = require_well_known_symbol();
    var Symbol2 = getBuiltIn("Symbol");
    var $isWellKnownSymbol = Symbol2.isWellKnownSymbol;
    var getOwnPropertyNames = getBuiltIn("Object", "getOwnPropertyNames");
    var thisSymbolValue = uncurryThis(Symbol2.prototype.valueOf);
    var WellKnownSymbolsStore = shared("wks");
    for (i2 = 0, symbolKeys = getOwnPropertyNames(Symbol2), symbolKeysLength = symbolKeys.length; i2 < symbolKeysLength; i2++) {
      try {
        symbolKey = symbolKeys[i2];
        if (isSymbol(Symbol2[symbolKey])) wellKnownSymbol(symbolKey);
      } catch (error3) {
      }
    }
    var symbolKey;
    var i2;
    var symbolKeys;
    var symbolKeysLength;
    module.exports = /* @__PURE__ */ __name(function isWellKnownSymbol(value) {
      if ($isWellKnownSymbol && $isWellKnownSymbol(value)) return true;
      try {
        var symbol = thisSymbolValue(value);
        for (var j = 0, keys = getOwnPropertyNames(WellKnownSymbolsStore), keysLength = keys.length; j < keysLength; j++) {
          if (WellKnownSymbolsStore[keys[j]] == symbol) return true;
        }
      } catch (error3) {
      }
      return false;
    }, "isWellKnownSymbol");
  }
});

// node_modules/core-js-pure/modules/esnext.symbol.is-well-known-symbol.js
var require_esnext_symbol_is_well_known_symbol = __commonJS({
  "node_modules/core-js-pure/modules/esnext.symbol.is-well-known-symbol.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $ = require_export();
    var isWellKnownSymbol = require_symbol_is_well_known();
    $({ target: "Symbol", stat: true, forced: true }, {
      isWellKnownSymbol
    });
  }
});

// node_modules/core-js-pure/modules/esnext.symbol.custom-matcher.js
var require_esnext_symbol_custom_matcher = __commonJS({
  "node_modules/core-js-pure/modules/esnext.symbol.custom-matcher.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("customMatcher");
  }
});

// node_modules/core-js-pure/modules/esnext.symbol.observable.js
var require_esnext_symbol_observable = __commonJS({
  "node_modules/core-js-pure/modules/esnext.symbol.observable.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("observable");
  }
});

// node_modules/core-js-pure/modules/esnext.symbol.is-registered.js
var require_esnext_symbol_is_registered = __commonJS({
  "node_modules/core-js-pure/modules/esnext.symbol.is-registered.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $ = require_export();
    var isRegisteredSymbol = require_symbol_is_registered();
    $({ target: "Symbol", stat: true, name: "isRegisteredSymbol" }, {
      isRegistered: isRegisteredSymbol
    });
  }
});

// node_modules/core-js-pure/modules/esnext.symbol.is-well-known.js
var require_esnext_symbol_is_well_known = __commonJS({
  "node_modules/core-js-pure/modules/esnext.symbol.is-well-known.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $ = require_export();
    var isWellKnownSymbol = require_symbol_is_well_known();
    $({ target: "Symbol", stat: true, name: "isWellKnownSymbol", forced: true }, {
      isWellKnown: isWellKnownSymbol
    });
  }
});

// node_modules/core-js-pure/modules/esnext.symbol.matcher.js
var require_esnext_symbol_matcher = __commonJS({
  "node_modules/core-js-pure/modules/esnext.symbol.matcher.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("matcher");
  }
});

// node_modules/core-js-pure/modules/esnext.symbol.metadata-key.js
var require_esnext_symbol_metadata_key = __commonJS({
  "node_modules/core-js-pure/modules/esnext.symbol.metadata-key.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("metadataKey");
  }
});

// node_modules/core-js-pure/modules/esnext.symbol.pattern-match.js
var require_esnext_symbol_pattern_match = __commonJS({
  "node_modules/core-js-pure/modules/esnext.symbol.pattern-match.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("patternMatch");
  }
});

// node_modules/core-js-pure/modules/esnext.symbol.replace-all.js
var require_esnext_symbol_replace_all = __commonJS({
  "node_modules/core-js-pure/modules/esnext.symbol.replace-all.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var defineWellKnownSymbol = require_well_known_symbol_define();
    defineWellKnownSymbol("replaceAll");
  }
});

// node_modules/core-js-pure/full/symbol/index.js
var require_symbol4 = __commonJS({
  "node_modules/core-js-pure/full/symbol/index.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_symbol3();
    require_esnext_symbol_is_registered_symbol();
    require_esnext_symbol_is_well_known_symbol();
    require_esnext_symbol_custom_matcher();
    require_esnext_symbol_observable();
    require_esnext_symbol_is_registered();
    require_esnext_symbol_is_well_known();
    require_esnext_symbol_matcher();
    require_esnext_symbol_metadata_key();
    require_esnext_symbol_pattern_match();
    require_esnext_symbol_replace_all();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/features/symbol/index.js
var require_symbol5 = __commonJS({
  "node_modules/core-js-pure/features/symbol/index.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = require_symbol4();
  }
});

// node_modules/core-js-pure/internals/string-multibyte.js
var require_string_multibyte = __commonJS({
  "node_modules/core-js-pure/internals/string-multibyte.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this();
    var toIntegerOrInfinity = require_to_integer_or_infinity();
    var toString = require_to_string();
    var requireObjectCoercible = require_require_object_coercible();
    var charAt = uncurryThis("".charAt);
    var charCodeAt = uncurryThis("".charCodeAt);
    var stringSlice = uncurryThis("".slice);
    var createMethod = /* @__PURE__ */ __name(function(CONVERT_TO_STRING) {
      return function($this, pos) {
        var S = toString(requireObjectCoercible($this));
        var position = toIntegerOrInfinity(pos);
        var size = S.length;
        var first, second;
        if (position < 0 || position >= size) return CONVERT_TO_STRING ? "" : void 0;
        first = charCodeAt(S, position);
        return first < 55296 || first > 56319 || position + 1 === size || (second = charCodeAt(S, position + 1)) < 56320 || second > 57343 ? CONVERT_TO_STRING ? charAt(S, position) : first : CONVERT_TO_STRING ? stringSlice(S, position, position + 2) : (first - 55296 << 10) + (second - 56320) + 65536;
      };
    }, "createMethod");
    module.exports = {
      // `String.prototype.codePointAt` method
      // https://tc39.es/ecma262/#sec-string.prototype.codepointat
      codeAt: createMethod(false),
      // `String.prototype.at` method
      // https://github.com/mathiasbynens/String.prototype.at
      charAt: createMethod(true)
    };
  }
});

// node_modules/core-js-pure/modules/es.string.iterator.js
var require_es_string_iterator = __commonJS({
  "node_modules/core-js-pure/modules/es.string.iterator.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var charAt = require_string_multibyte().charAt;
    var toString = require_to_string();
    var InternalStateModule = require_internal_state();
    var defineIterator = require_iterator_define();
    var createIterResultObject = require_create_iter_result_object();
    var STRING_ITERATOR = "String Iterator";
    var setInternalState = InternalStateModule.set;
    var getInternalState = InternalStateModule.getterFor(STRING_ITERATOR);
    defineIterator(String, "String", function(iterated) {
      setInternalState(this, {
        type: STRING_ITERATOR,
        string: toString(iterated),
        index: 0
      });
    }, /* @__PURE__ */ __name(function next() {
      var state = getInternalState(this);
      var string = state.string;
      var index = state.index;
      var point;
      if (index >= string.length) return createIterResultObject(void 0, true);
      point = charAt(string, index);
      state.index += point.length;
      return createIterResultObject(point, false);
    }, "next"));
  }
});

// node_modules/core-js-pure/es/symbol/iterator.js
var require_iterator = __commonJS({
  "node_modules/core-js-pure/es/symbol/iterator.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    require_es_array_iterator();
    require_es_object_to_string();
    require_es_string_iterator();
    require_es_symbol_iterator();
    var WrappedWellKnownSymbolModule = require_well_known_symbol_wrapped();
    module.exports = WrappedWellKnownSymbolModule.f("iterator");
  }
});

// node_modules/core-js-pure/stable/symbol/iterator.js
var require_iterator2 = __commonJS({
  "node_modules/core-js-pure/stable/symbol/iterator.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_iterator();
    require_web_dom_collections_iterator();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/actual/symbol/iterator.js
var require_iterator3 = __commonJS({
  "node_modules/core-js-pure/actual/symbol/iterator.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_iterator2();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/full/symbol/iterator.js
var require_iterator4 = __commonJS({
  "node_modules/core-js-pure/full/symbol/iterator.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_iterator3();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/features/symbol/iterator.js
var require_iterator5 = __commonJS({
  "node_modules/core-js-pure/features/symbol/iterator.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = require_iterator4();
  }
});

// node_modules/core-js-pure/modules/es.date.to-primitive.js
var require_es_date_to_primitive = __commonJS({
  "node_modules/core-js-pure/modules/es.date.to-primitive.js"() {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
  }
});

// node_modules/core-js-pure/es/symbol/to-primitive.js
var require_to_primitive2 = __commonJS({
  "node_modules/core-js-pure/es/symbol/to-primitive.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    require_es_date_to_primitive();
    require_es_symbol_to_primitive();
    var WrappedWellKnownSymbolModule = require_well_known_symbol_wrapped();
    module.exports = WrappedWellKnownSymbolModule.f("toPrimitive");
  }
});

// node_modules/core-js-pure/stable/symbol/to-primitive.js
var require_to_primitive3 = __commonJS({
  "node_modules/core-js-pure/stable/symbol/to-primitive.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_to_primitive2();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/actual/symbol/to-primitive.js
var require_to_primitive4 = __commonJS({
  "node_modules/core-js-pure/actual/symbol/to-primitive.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_to_primitive3();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/full/symbol/to-primitive.js
var require_to_primitive5 = __commonJS({
  "node_modules/core-js-pure/full/symbol/to-primitive.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_to_primitive4();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/features/symbol/to-primitive.js
var require_to_primitive6 = __commonJS({
  "node_modules/core-js-pure/features/symbol/to-primitive.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = require_to_primitive5();
  }
});

// node_modules/core-js-pure/internals/whitespaces.js
var require_whitespaces = __commonJS({
  "node_modules/core-js-pure/internals/whitespaces.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = "	\n\v\f\r \xA0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u2028\u2029\uFEFF";
  }
});

// node_modules/core-js-pure/internals/string-trim.js
var require_string_trim = __commonJS({
  "node_modules/core-js-pure/internals/string-trim.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var uncurryThis = require_function_uncurry_this();
    var requireObjectCoercible = require_require_object_coercible();
    var toString = require_to_string();
    var whitespaces = require_whitespaces();
    var replace = uncurryThis("".replace);
    var ltrim = RegExp("^[" + whitespaces + "]+");
    var rtrim = RegExp("(^|[^" + whitespaces + "])[" + whitespaces + "]+$");
    var createMethod = /* @__PURE__ */ __name(function(TYPE) {
      return function($this) {
        var string = toString(requireObjectCoercible($this));
        if (TYPE & 1) string = replace(string, ltrim, "");
        if (TYPE & 2) string = replace(string, rtrim, "$1");
        return string;
      };
    }, "createMethod");
    module.exports = {
      // `String.prototype.{ trimLeft, trimStart }` methods
      // https://tc39.es/ecma262/#sec-string.prototype.trimstart
      start: createMethod(1),
      // `String.prototype.{ trimRight, trimEnd }` methods
      // https://tc39.es/ecma262/#sec-string.prototype.trimend
      end: createMethod(2),
      // `String.prototype.trim` method
      // https://tc39.es/ecma262/#sec-string.prototype.trim
      trim: createMethod(3)
    };
  }
});

// node_modules/core-js-pure/internals/string-trim-forced.js
var require_string_trim_forced = __commonJS({
  "node_modules/core-js-pure/internals/string-trim-forced.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var PROPER_FUNCTION_NAME = require_function_name().PROPER;
    var fails = require_fails();
    var whitespaces = require_whitespaces();
    var non = "\u200B\x85\u180E";
    module.exports = function(METHOD_NAME) {
      return fails(function() {
        return !!whitespaces[METHOD_NAME]() || non[METHOD_NAME]() !== non || PROPER_FUNCTION_NAME && whitespaces[METHOD_NAME].name !== METHOD_NAME;
      });
    };
  }
});

// node_modules/core-js-pure/modules/es.string.trim.js
var require_es_string_trim = __commonJS({
  "node_modules/core-js-pure/modules/es.string.trim.js"() {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var $ = require_export();
    var $trim = require_string_trim().trim;
    var forcedStringTrimMethod = require_string_trim_forced();
    $({ target: "String", proto: true, forced: forcedStringTrimMethod("trim") }, {
      trim: /* @__PURE__ */ __name(function trim() {
        return $trim(this);
      }, "trim")
    });
  }
});

// node_modules/core-js-pure/internals/get-built-in-prototype-method.js
var require_get_built_in_prototype_method = __commonJS({
  "node_modules/core-js-pure/internals/get-built-in-prototype-method.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var globalThis2 = require_global_this();
    var path = require_path();
    module.exports = function(CONSTRUCTOR, METHOD) {
      var Namespace = path[CONSTRUCTOR + "Prototype"];
      var pureMethod = Namespace && Namespace[METHOD];
      if (pureMethod) return pureMethod;
      var NativeConstructor = globalThis2[CONSTRUCTOR];
      var NativePrototype = NativeConstructor && NativeConstructor.prototype;
      return NativePrototype && NativePrototype[METHOD];
    };
  }
});

// node_modules/core-js-pure/es/string/virtual/trim.js
var require_trim = __commonJS({
  "node_modules/core-js-pure/es/string/virtual/trim.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    require_es_string_trim();
    var getBuiltInPrototypeMethod = require_get_built_in_prototype_method();
    module.exports = getBuiltInPrototypeMethod("String", "trim");
  }
});

// node_modules/core-js-pure/es/instance/trim.js
var require_trim2 = __commonJS({
  "node_modules/core-js-pure/es/instance/trim.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var isPrototypeOf = require_object_is_prototype_of();
    var method = require_trim();
    var StringPrototype = String.prototype;
    module.exports = function(it) {
      var own = it.trim;
      return typeof it == "string" || it === StringPrototype || isPrototypeOf(StringPrototype, it) && own === StringPrototype.trim ? method : own;
    };
  }
});

// node_modules/core-js-pure/stable/instance/trim.js
var require_trim3 = __commonJS({
  "node_modules/core-js-pure/stable/instance/trim.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_trim2();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/actual/instance/trim.js
var require_trim4 = __commonJS({
  "node_modules/core-js-pure/actual/instance/trim.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_trim3();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/full/instance/trim.js
var require_trim5 = __commonJS({
  "node_modules/core-js-pure/full/instance/trim.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var parent = require_trim4();
    module.exports = parent;
  }
});

// node_modules/core-js-pure/features/instance/trim.js
var require_trim6 = __commonJS({
  "node_modules/core-js-pure/features/instance/trim.js"(exports, module) {
    "use strict";
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = require_trim5();
  }
});

// node_modules/@babel/runtime-corejs3/core-js/instance/trim.js
var require_trim7 = __commonJS({
  "node_modules/@babel/runtime-corejs3/core-js/instance/trim.js"(exports, module) {
    init_modules_watch_stub();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = require_trim6();
  }
});

// .wrangler/tmp/bundle-SKjzej/middleware-loader.entry.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// .wrangler/tmp/bundle-SKjzej/middleware-insertion-facade.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/index.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/index.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/hono.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/hono-base.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/compose.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context2, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i2) {
      if (i2 <= index) {
        throw new Error("next() called multiple times");
      }
      index = i2;
      let res;
      let isError = false;
      let handler;
      if (middleware[i2]) {
        handler = middleware[i2][0][0];
        context2.req.routeIndex = i2;
      } else {
        handler = i2 === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context2, () => dispatch(i2 + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context2.error = err;
            res = await onError(err, context2);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context2.finalized === false && onNotFound) {
          res = await onNotFound(context2);
        }
      }
      if (res && (context2.finalized === false || isError)) {
        context2.res = res;
      }
      return context2;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// node_modules/hono/dist/context.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/request.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/http-exception.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/request/constants.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/hono/dist/utils/body.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = request instanceof HonoRequest ? request.raw.headers : request.headers;
  const contentType = headers.get("Content-Type");
  if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) {
    return parseFormData(request, { all, dot });
  }
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  const formData = await request.formData();
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value) => {
  if (/(?:^|\.)__proto__\./.test(key)) {
    return;
  }
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");

// node_modules/hono/dist/utils/url.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i2 = groups.length - 1; i2 >= 0; i2--) {
    const [mark] = groups[i2];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i2][1]);
        break;
      }
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder2) => {
  try {
    return decoder2(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder2(match2);
      } catch {
        return match2;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i2 = start;
  for (; i2 < url.length; i2++) {
    const charCode = url.charCodeAt(i2);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i2);
      const hashIndex = url.indexOf("#", i2);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i2);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i2, a2) => a2.indexOf(v) === i2);
}, "checkOptionalParameter");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURIComponent_), "tryDecodeURIComponent");
var HonoRequest = class {
  static {
    __name(this, "HonoRequest");
  }
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = {};
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = /* @__PURE__ */ __name((key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  }, "#cachedBody");
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context2, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c2) => c2({ phase, buffer, context: context2 }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context2, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
}, "resolveCallback");

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var createResponseInstance = /* @__PURE__ */ __name((body, init) => new Response(body, init), "createResponseInstance");
var Context = class {
  static {
    __name(this, "Context");
  }
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = /* @__PURE__ */ __name((...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  }, "render");
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = /* @__PURE__ */ __name((layout) => this.#layout = layout, "setLayout");
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = /* @__PURE__ */ __name(() => this.#layout, "getLayout");
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = /* @__PURE__ */ __name((renderer) => {
    this.#renderer = renderer;
  }, "setRenderer");
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = /* @__PURE__ */ __name((name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  }, "header");
  status = /* @__PURE__ */ __name((status) => {
    this.#status = status;
  }, "status");
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = /* @__PURE__ */ __name((key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  }, "set");
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = /* @__PURE__ */ __name((key) => {
    return this.#var ? this.#var.get(key) : void 0;
  }, "get");
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, { status, headers: responseHeaders });
  }
  newResponse = /* @__PURE__ */ __name((...args) => this.#newResponse(...args), "newResponse");
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = /* @__PURE__ */ __name((data, arg, headers) => this.#newResponse(data, arg, headers), "body");
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = /* @__PURE__ */ __name((text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  }, "text");
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = /* @__PURE__ */ __name((object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  }, "json");
  html = /* @__PURE__ */ __name((html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  }, "html");
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = /* @__PURE__ */ __name((location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  }, "redirect");
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name(() => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  }, "notFound");
};

// node_modules/hono/dist/router.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
  static {
    __name(this, "UnsupportedPathError");
  }
};

// node_modules/hono/dist/utils/constants.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c2) => {
  return c2.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c2) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c2.newResponse(res.body, res);
  }
  console.error(err);
  return c2.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = class _Hono {
  static {
    __name(this, "_Hono");
  }
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r3) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r3.handler;
      } else {
        handler = /* @__PURE__ */ __name(async (c2, next) => (await compose([], app2.errorHandler)(c2, () => r3.handler(c2, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r3.handler;
      }
      subApp.#addRoute(r3.method, r3.path, handler);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = /* @__PURE__ */ __name((handler) => {
    this.errorHandler = handler;
    return this;
  }, "onError");
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name((handler) => {
    this.#notFoundHandler = handler;
    return this;
  }, "notFound");
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c2) => {
      const options2 = optionHandler(c2);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c2) => {
      let executionContext = void 0;
      try {
        executionContext = c2.executionCtx;
      } catch {
      }
      return [c2.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = url.pathname.slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = /* @__PURE__ */ __name(async (c2, next) => {
      const res = await applicationHandler(replaceRequest(c2.req.raw), ...getOptions(c2));
      if (res) {
        return res;
      }
      await next();
    }, "handler");
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r3 = { basePath: this._basePath, path, method, handler };
    this.router.add(method, path, [handler, r3]);
    this.routes.push(r3);
  }
  #handleError(err, c2) {
    if (err instanceof Error) {
      return this.errorHandler(err, c2);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env2, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env2, "GET")))();
    }
    const path = this.getPath(request, { env: env2 });
    const matchResult = this.router.match(method, path);
    const c2 = new Context(request, {
      path,
      matchResult,
      env: env2,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c2, async () => {
          c2.res = await this.#notFoundHandler(c2);
        });
      } catch (err) {
        return this.#handleError(err, c2);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c2.finalized ? c2.res : this.#notFoundHandler(c2))
      ).catch((err) => this.#handleError(err, c2)) : res ?? this.#notFoundHandler(c2);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context2 = await composed(c2);
        if (!context2.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context2.res;
      } catch (err) {
        return this.#handleError(err, c2);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} Env - env Object
   * @param {ExecutionContext} - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = /* @__PURE__ */ __name((request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  }, "fetch");
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = /* @__PURE__ */ __name((input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  }, "request");
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = /* @__PURE__ */ __name(() => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  }, "fire");
};

// node_modules/hono/dist/router/reg-exp-router/index.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/router/reg-exp-router/router.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/router/reg-exp-router/matcher.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name(((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  }), "match2");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// node_modules/hono/dist/router/reg-exp-router/node.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a2, b) {
  if (a2.length === 1) {
    return b.length === 1 ? a2 < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a2 === ONLY_WILDCARD_REG_EXP_STR || a2 === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a2 === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a2.length === b.length ? a2 < b ? -1 : 1 : b.length - a2.length;
}
__name(compareKey, "compareKey");
var Node = class _Node {
  static {
    __name(this, "_Node");
  }
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context2, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node();
        if (name !== "") {
          node.#varIndex = context2.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node();
      }
    }
    node.insert(restTokens, index, paramMap, context2, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c2 = this.#children[k];
      return (typeof c2.#varIndex === "number" ? `(${k})@${c2.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c2.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var Trie = class {
  static {
    __name(this, "Trie");
  }
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i2 = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i2}`;
        groups[i2] = [mark, m];
        i2++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i2 = groups.length - 1; i2 >= 0; i2--) {
      const [mark] = groups[i2];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i2][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
__name(buildWildcardRegExp, "buildWildcardRegExp");
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
__name(clearWildcardRegExpCache, "clearWildcardRegExpCache");
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i2 = 0, j = -1, len = routesWithStaticPathFlag.length; i2 < len; i2++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i2];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h2]) => [h2, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h2, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h2, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i2 = 0, len = handlerData.length; i2 < len; i2++) {
    for (let j = 0, len2 = handlerData[i2].length; j < len2; j++) {
      const map = handlerData[i2][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i2 in indexReplacementMap) {
    handlerMap[i2] = handlerData[indexReplacementMap[i2]];
  }
  return [regexp, handlerMap, staticMap];
}
__name(buildMatcherFromPreprocessedRoutes, "buildMatcherFromPreprocessedRoutes");
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a2, b) => b.length - a2.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
__name(findMiddleware, "findMiddleware");
var RegExpRouter = class {
  static {
    __name(this, "RegExpRouter");
  }
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i2 = 0, len = paths.length; i2 < len; i2++) {
      const path2 = paths[i2];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i2 + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r3) => {
      const ownRoute = r3[method] ? Object.keys(r3[method]).map((path) => [path, r3[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r3[METHOD_NAME_ALL]).map((path) => [path, r3[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};

// node_modules/hono/dist/router/reg-exp-router/prepared-router.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/router/smart-router/index.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/router/smart-router/router.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var SmartRouter = class {
  static {
    __name(this, "SmartRouter");
  }
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i2 = 0;
    let res;
    for (; i2 < len; i2++) {
      const router = routers[i2];
      try {
        for (let i22 = 0, len2 = routes.length; i22 < len2; i22++) {
          router.add(...routes[i22]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i2 === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/index.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/router/trie-router/router.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/router/trie-router/node.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var emptyParams = /* @__PURE__ */ Object.create(null);
var hasChildren = /* @__PURE__ */ __name((children) => {
  for (const _ in children) {
    return true;
  }
  return false;
}, "hasChildren");
var Node2 = class _Node2 {
  static {
    __name(this, "_Node");
  }
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i2 = 0, len = parts.length; i2 < len; i2++) {
      const p = parts[i2];
      const nextP = parts[i2 + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i2, a2) => a2.indexOf(v) === i2),
        score: this.#order
      }
    });
    return curNode;
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i2 = 0, len = node.#methods.length; i2 < len; i2++) {
      const m = node.#methods[i2];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i22 = 0, len2 = handlerSet.possibleKeys.length; i22 < len2; i22++) {
            const key = handlerSet.possibleKeys[i22];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i2 = 0; i2 < len; i2++) {
      const part = parts[i2];
      const isLast = i2 === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          if (matcher instanceof RegExp) {
            if (partOffsets === null) {
              partOffsets = new Array(len);
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.substring(partOffsets[i2]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (hasChildren(child.#children)) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a2, b) => {
        return a2.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  static {
    __name(this, "TrieRouter");
  }
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i2 = 0, len = results.length; i2 < len; i2++) {
        this.#node.insert(method, results[i2], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  static {
    __name(this, "Hono");
  }
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// node_modules/hono/dist/middleware/cors/index.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var cors = /* @__PURE__ */ __name((options) => {
  const defaults = {
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
    allowHeaders: [],
    exposeHeaders: []
  };
  const opts = {
    ...defaults,
    ...options
  };
  const findAllowOrigin = ((optsOrigin) => {
    if (typeof optsOrigin === "string") {
      if (optsOrigin === "*") {
        if (opts.credentials) {
          return (origin) => origin || null;
        }
        return () => optsOrigin;
      } else {
        return (origin) => optsOrigin === origin ? origin : null;
      }
    } else if (typeof optsOrigin === "function") {
      return optsOrigin;
    } else {
      return (origin) => optsOrigin.includes(origin) ? origin : null;
    }
  })(opts.origin);
  const findAllowMethods = ((optsAllowMethods) => {
    if (typeof optsAllowMethods === "function") {
      return optsAllowMethods;
    } else if (Array.isArray(optsAllowMethods)) {
      return () => optsAllowMethods;
    } else {
      return () => [];
    }
  })(opts.allowMethods);
  return /* @__PURE__ */ __name(async function cors2(c2, next) {
    function set(key, value) {
      c2.res.headers.set(key, value);
    }
    __name(set, "set");
    const allowOrigin = await findAllowOrigin(c2.req.header("origin") || "", c2);
    if (allowOrigin) {
      set("Access-Control-Allow-Origin", allowOrigin);
    }
    if (opts.credentials) {
      set("Access-Control-Allow-Credentials", "true");
    }
    if (opts.exposeHeaders?.length) {
      set("Access-Control-Expose-Headers", opts.exposeHeaders.join(","));
    }
    if (c2.req.method === "OPTIONS") {
      if (opts.origin !== "*" || opts.credentials) {
        set("Vary", "Origin");
      }
      if (opts.maxAge != null) {
        set("Access-Control-Max-Age", opts.maxAge.toString());
      }
      const allowMethods = await findAllowMethods(c2.req.header("origin") || "", c2);
      if (allowMethods.length) {
        set("Access-Control-Allow-Methods", allowMethods.join(","));
      }
      let headers = opts.allowHeaders;
      if (!headers?.length) {
        const requestHeaders = c2.req.header("Access-Control-Request-Headers");
        if (requestHeaders) {
          headers = requestHeaders.split(/\s*,\s*/);
        }
      }
      if (headers?.length) {
        set("Access-Control-Allow-Headers", headers.join(","));
        c2.res.headers.append("Vary", "Access-Control-Request-Headers");
      }
      c2.res.headers.delete("Content-Length");
      c2.res.headers.delete("Content-Type");
      return new Response(null, {
        headers: c2.res.headers,
        status: 204,
        statusText: "No Content"
      });
    }
    await next();
    if (opts.origin !== "*" || opts.credentials) {
      c2.header("Vary", "Origin", { append: true });
    }
  }, "cors2");
}, "cors");

// src/db.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function getSQL(env2) {
  const db = env2.DB;
  const tag2 = /* @__PURE__ */ __name(async function(strings, ...values) {
    let sql = "";
    strings.forEach((str, i2) => {
      sql += str;
      if (i2 < values.length) sql += "?";
    });
    const result = await db.prepare(sql).bind(...values).all();
    return result.results ?? [];
  }, "tag");
  tag2.end = async () => {
  };
  tag2.unsafe = async (sql, params = []) => {
    const result = await db.prepare(sql).bind(...params).all();
    return result.results ?? [];
  };
  return tag2;
}
__name(getSQL, "getSQL");

// src/auth.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/jose/dist/browser/index.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/jose/dist/browser/runtime/base64url.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/jose/dist/browser/lib/buffer_utils.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/jose/dist/browser/runtime/webcrypto.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var webcrypto_default = crypto;
var isCryptoKey = /* @__PURE__ */ __name((key) => key instanceof CryptoKey, "isCryptoKey");

// node_modules/jose/dist/browser/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0);
  const buf = new Uint8Array(size);
  let i2 = 0;
  for (const buffer of buffers) {
    buf.set(buffer, i2);
    i2 += buffer.length;
  }
  return buf;
}
__name(concat, "concat");

// node_modules/jose/dist/browser/runtime/base64url.js
var encodeBase64 = /* @__PURE__ */ __name((input) => {
  let unencoded = input;
  if (typeof unencoded === "string") {
    unencoded = encoder.encode(unencoded);
  }
  const CHUNK_SIZE = 32768;
  const arr = [];
  for (let i2 = 0; i2 < unencoded.length; i2 += CHUNK_SIZE) {
    arr.push(String.fromCharCode.apply(null, unencoded.subarray(i2, i2 + CHUNK_SIZE)));
  }
  return btoa(arr.join(""));
}, "encodeBase64");
var encode = /* @__PURE__ */ __name((input) => {
  return encodeBase64(input).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}, "encode");
var decodeBase64 = /* @__PURE__ */ __name((encoded) => {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i2 = 0; i2 < binary.length; i2++) {
    bytes[i2] = binary.charCodeAt(i2);
  }
  return bytes;
}, "decodeBase64");
var decode = /* @__PURE__ */ __name((input) => {
  let encoded = input;
  if (encoded instanceof Uint8Array) {
    encoded = decoder.decode(encoded);
  }
  encoded = encoded.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  try {
    return decodeBase64(encoded);
  } catch {
    throw new TypeError("The input to be decoded is not correctly encoded.");
  }
}, "decode");

// node_modules/jose/dist/browser/util/errors.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var JOSEError = class extends Error {
  static {
    __name(this, "JOSEError");
  }
  constructor(message2, options) {
    super(message2, options);
    this.code = "ERR_JOSE_GENERIC";
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
JOSEError.code = "ERR_JOSE_GENERIC";
var JWTClaimValidationFailed = class extends JOSEError {
  static {
    __name(this, "JWTClaimValidationFailed");
  }
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
JWTClaimValidationFailed.code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
var JWTExpired = class extends JOSEError {
  static {
    __name(this, "JWTExpired");
  }
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.code = "ERR_JWT_EXPIRED";
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
JWTExpired.code = "ERR_JWT_EXPIRED";
var JOSEAlgNotAllowed = class extends JOSEError {
  static {
    __name(this, "JOSEAlgNotAllowed");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JOSE_ALG_NOT_ALLOWED";
  }
};
JOSEAlgNotAllowed.code = "ERR_JOSE_ALG_NOT_ALLOWED";
var JOSENotSupported = class extends JOSEError {
  static {
    __name(this, "JOSENotSupported");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JOSE_NOT_SUPPORTED";
  }
};
JOSENotSupported.code = "ERR_JOSE_NOT_SUPPORTED";
var JWEDecryptionFailed = class extends JOSEError {
  static {
    __name(this, "JWEDecryptionFailed");
  }
  constructor(message2 = "decryption operation failed", options) {
    super(message2, options);
    this.code = "ERR_JWE_DECRYPTION_FAILED";
  }
};
JWEDecryptionFailed.code = "ERR_JWE_DECRYPTION_FAILED";
var JWEInvalid = class extends JOSEError {
  static {
    __name(this, "JWEInvalid");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JWE_INVALID";
  }
};
JWEInvalid.code = "ERR_JWE_INVALID";
var JWSInvalid = class extends JOSEError {
  static {
    __name(this, "JWSInvalid");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JWS_INVALID";
  }
};
JWSInvalid.code = "ERR_JWS_INVALID";
var JWTInvalid = class extends JOSEError {
  static {
    __name(this, "JWTInvalid");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JWT_INVALID";
  }
};
JWTInvalid.code = "ERR_JWT_INVALID";
var JWKInvalid = class extends JOSEError {
  static {
    __name(this, "JWKInvalid");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JWK_INVALID";
  }
};
JWKInvalid.code = "ERR_JWK_INVALID";
var JWKSInvalid = class extends JOSEError {
  static {
    __name(this, "JWKSInvalid");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JWKS_INVALID";
  }
};
JWKSInvalid.code = "ERR_JWKS_INVALID";
var JWKSNoMatchingKey = class extends JOSEError {
  static {
    __name(this, "JWKSNoMatchingKey");
  }
  constructor(message2 = "no applicable key found in the JSON Web Key Set", options) {
    super(message2, options);
    this.code = "ERR_JWKS_NO_MATCHING_KEY";
  }
};
JWKSNoMatchingKey.code = "ERR_JWKS_NO_MATCHING_KEY";
var JWKSMultipleMatchingKeys = class extends JOSEError {
  static {
    __name(this, "JWKSMultipleMatchingKeys");
  }
  constructor(message2 = "multiple matching keys found in the JSON Web Key Set", options) {
    super(message2, options);
    this.code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  }
};
JWKSMultipleMatchingKeys.code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
var JWKSTimeout = class extends JOSEError {
  static {
    __name(this, "JWKSTimeout");
  }
  constructor(message2 = "request timed out", options) {
    super(message2, options);
    this.code = "ERR_JWKS_TIMEOUT";
  }
};
JWKSTimeout.code = "ERR_JWKS_TIMEOUT";
var JWSSignatureVerificationFailed = class extends JOSEError {
  static {
    __name(this, "JWSSignatureVerificationFailed");
  }
  constructor(message2 = "signature verification failed", options) {
    super(message2, options);
    this.code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  }
};
JWSSignatureVerificationFailed.code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";

// node_modules/jose/dist/browser/lib/crypto_key.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function unusable(name, prop = "algorithm.name") {
  return new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`);
}
__name(unusable, "unusable");
function isAlgorithm(algorithm, name) {
  return algorithm.name === name;
}
__name(isAlgorithm, "isAlgorithm");
function getHashLength(hash) {
  return parseInt(hash.name.slice(4), 10);
}
__name(getHashLength, "getHashLength");
function getNamedCurve(alg) {
  switch (alg) {
    case "ES256":
      return "P-256";
    case "ES384":
      return "P-384";
    case "ES512":
      return "P-521";
    default:
      throw new Error("unreachable");
  }
}
__name(getNamedCurve, "getNamedCurve");
function checkUsage(key, usages) {
  if (usages.length && !usages.some((expected) => key.usages.includes(expected))) {
    let msg = "CryptoKey does not support this operation, its usages must include ";
    if (usages.length > 2) {
      const last = usages.pop();
      msg += `one of ${usages.join(", ")}, or ${last}.`;
    } else if (usages.length === 2) {
      msg += `one of ${usages[0]} or ${usages[1]}.`;
    } else {
      msg += `${usages[0]}.`;
    }
    throw new TypeError(msg);
  }
}
__name(checkUsage, "checkUsage");
function checkSigCryptoKey(key, alg, ...usages) {
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512": {
      if (!isAlgorithm(key.algorithm, "HMAC"))
        throw unusable("HMAC");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "RS256":
    case "RS384":
    case "RS512": {
      if (!isAlgorithm(key.algorithm, "RSASSA-PKCS1-v1_5"))
        throw unusable("RSASSA-PKCS1-v1_5");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "PS256":
    case "PS384":
    case "PS512": {
      if (!isAlgorithm(key.algorithm, "RSA-PSS"))
        throw unusable("RSA-PSS");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "EdDSA": {
      if (key.algorithm.name !== "Ed25519" && key.algorithm.name !== "Ed448") {
        throw unusable("Ed25519 or Ed448");
      }
      break;
    }
    case "Ed25519": {
      if (!isAlgorithm(key.algorithm, "Ed25519"))
        throw unusable("Ed25519");
      break;
    }
    case "ES256":
    case "ES384":
    case "ES512": {
      if (!isAlgorithm(key.algorithm, "ECDSA"))
        throw unusable("ECDSA");
      const expected = getNamedCurve(alg);
      const actual = key.algorithm.namedCurve;
      if (actual !== expected)
        throw unusable(expected, "algorithm.namedCurve");
      break;
    }
    default:
      throw new TypeError("CryptoKey does not support this operation");
  }
  checkUsage(key, usages);
}
__name(checkSigCryptoKey, "checkSigCryptoKey");

// node_modules/jose/dist/browser/lib/invalid_key_input.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function message(msg, actual, ...types2) {
  types2 = types2.filter(Boolean);
  if (types2.length > 2) {
    const last = types2.pop();
    msg += `one of type ${types2.join(", ")}, or ${last}.`;
  } else if (types2.length === 2) {
    msg += `one of type ${types2[0]} or ${types2[1]}.`;
  } else {
    msg += `of type ${types2[0]}.`;
  }
  if (actual == null) {
    msg += ` Received ${actual}`;
  } else if (typeof actual === "function" && actual.name) {
    msg += ` Received function ${actual.name}`;
  } else if (typeof actual === "object" && actual != null) {
    if (actual.constructor?.name) {
      msg += ` Received an instance of ${actual.constructor.name}`;
    }
  }
  return msg;
}
__name(message, "message");
var invalid_key_input_default = /* @__PURE__ */ __name((actual, ...types2) => {
  return message("Key must be ", actual, ...types2);
}, "default");
function withAlg(alg, actual, ...types2) {
  return message(`Key for the ${alg} algorithm must be `, actual, ...types2);
}
__name(withAlg, "withAlg");

// node_modules/jose/dist/browser/runtime/is_key_like.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var is_key_like_default = /* @__PURE__ */ __name((key) => {
  if (isCryptoKey(key)) {
    return true;
  }
  return key?.[Symbol.toStringTag] === "KeyObject";
}, "default");
var types = ["CryptoKey"];

// node_modules/jose/dist/browser/lib/is_disjoint.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var isDisjoint = /* @__PURE__ */ __name((...headers) => {
  const sources = headers.filter(Boolean);
  if (sources.length === 0 || sources.length === 1) {
    return true;
  }
  let acc;
  for (const header of sources) {
    const parameters = Object.keys(header);
    if (!acc || acc.size === 0) {
      acc = new Set(parameters);
      continue;
    }
    for (const parameter of parameters) {
      if (acc.has(parameter)) {
        return false;
      }
      acc.add(parameter);
    }
  }
  return true;
}, "isDisjoint");
var is_disjoint_default = isDisjoint;

// node_modules/jose/dist/browser/lib/is_object.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function isObjectLike(value) {
  return typeof value === "object" && value !== null;
}
__name(isObjectLike, "isObjectLike");
function isObject(input) {
  if (!isObjectLike(input) || Object.prototype.toString.call(input) !== "[object Object]") {
    return false;
  }
  if (Object.getPrototypeOf(input) === null) {
    return true;
  }
  let proto = input;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }
  return Object.getPrototypeOf(input) === proto;
}
__name(isObject, "isObject");

// node_modules/jose/dist/browser/runtime/check_key_length.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var check_key_length_default = /* @__PURE__ */ __name((alg, key) => {
  if (alg.startsWith("RS") || alg.startsWith("PS")) {
    const { modulusLength } = key.algorithm;
    if (typeof modulusLength !== "number" || modulusLength < 2048) {
      throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
    }
  }
}, "default");

// node_modules/jose/dist/browser/runtime/normalize_key.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/jose/dist/browser/lib/is_jwk.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function isJWK(key) {
  return isObject(key) && typeof key.kty === "string";
}
__name(isJWK, "isJWK");
function isPrivateJWK(key) {
  return key.kty !== "oct" && typeof key.d === "string";
}
__name(isPrivateJWK, "isPrivateJWK");
function isPublicJWK(key) {
  return key.kty !== "oct" && typeof key.d === "undefined";
}
__name(isPublicJWK, "isPublicJWK");
function isSecretJWK(key) {
  return isJWK(key) && key.kty === "oct" && typeof key.k === "string";
}
__name(isSecretJWK, "isSecretJWK");

// node_modules/jose/dist/browser/runtime/jwk_to_key.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function subtleMapping(jwk) {
  let algorithm;
  let keyUsages;
  switch (jwk.kty) {
    case "RSA": {
      switch (jwk.alg) {
        case "PS256":
        case "PS384":
        case "PS512":
          algorithm = { name: "RSA-PSS", hash: `SHA-${jwk.alg.slice(-3)}` };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "RS256":
        case "RS384":
        case "RS512":
          algorithm = { name: "RSASSA-PKCS1-v1_5", hash: `SHA-${jwk.alg.slice(-3)}` };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "RSA-OAEP":
        case "RSA-OAEP-256":
        case "RSA-OAEP-384":
        case "RSA-OAEP-512":
          algorithm = {
            name: "RSA-OAEP",
            hash: `SHA-${parseInt(jwk.alg.slice(-3), 10) || 1}`
          };
          keyUsages = jwk.d ? ["decrypt", "unwrapKey"] : ["encrypt", "wrapKey"];
          break;
        default:
          throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      }
      break;
    }
    case "EC": {
      switch (jwk.alg) {
        case "ES256":
          algorithm = { name: "ECDSA", namedCurve: "P-256" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ES384":
          algorithm = { name: "ECDSA", namedCurve: "P-384" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ES512":
          algorithm = { name: "ECDSA", namedCurve: "P-521" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW":
          algorithm = { name: "ECDH", namedCurve: jwk.crv };
          keyUsages = jwk.d ? ["deriveBits"] : [];
          break;
        default:
          throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      }
      break;
    }
    case "OKP": {
      switch (jwk.alg) {
        case "Ed25519":
          algorithm = { name: "Ed25519" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "EdDSA":
          algorithm = { name: jwk.crv };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW":
          algorithm = { name: jwk.crv };
          keyUsages = jwk.d ? ["deriveBits"] : [];
          break;
        default:
          throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      }
      break;
    }
    default:
      throw new JOSENotSupported('Invalid or unsupported JWK "kty" (Key Type) Parameter value');
  }
  return { algorithm, keyUsages };
}
__name(subtleMapping, "subtleMapping");
var parse = /* @__PURE__ */ __name(async (jwk) => {
  if (!jwk.alg) {
    throw new TypeError('"alg" argument is required when "jwk.alg" is not present');
  }
  const { algorithm, keyUsages } = subtleMapping(jwk);
  const rest = [
    algorithm,
    jwk.ext ?? false,
    jwk.key_ops ?? keyUsages
  ];
  const keyData = { ...jwk };
  delete keyData.alg;
  delete keyData.use;
  return webcrypto_default.subtle.importKey("jwk", keyData, ...rest);
}, "parse");
var jwk_to_key_default = parse;

// node_modules/jose/dist/browser/runtime/normalize_key.js
var exportKeyValue = /* @__PURE__ */ __name((k) => decode(k), "exportKeyValue");
var privCache;
var pubCache;
var isKeyObject = /* @__PURE__ */ __name((key) => {
  return key?.[Symbol.toStringTag] === "KeyObject";
}, "isKeyObject");
var importAndCache = /* @__PURE__ */ __name(async (cache, key, jwk, alg, freeze = false) => {
  let cached = cache.get(key);
  if (cached?.[alg]) {
    return cached[alg];
  }
  const cryptoKey = await jwk_to_key_default({ ...jwk, alg });
  if (freeze)
    Object.freeze(key);
  if (!cached) {
    cache.set(key, { [alg]: cryptoKey });
  } else {
    cached[alg] = cryptoKey;
  }
  return cryptoKey;
}, "importAndCache");
var normalizePublicKey = /* @__PURE__ */ __name((key, alg) => {
  if (isKeyObject(key)) {
    let jwk = key.export({ format: "jwk" });
    delete jwk.d;
    delete jwk.dp;
    delete jwk.dq;
    delete jwk.p;
    delete jwk.q;
    delete jwk.qi;
    if (jwk.k) {
      return exportKeyValue(jwk.k);
    }
    pubCache || (pubCache = /* @__PURE__ */ new WeakMap());
    return importAndCache(pubCache, key, jwk, alg);
  }
  if (isJWK(key)) {
    if (key.k)
      return decode(key.k);
    pubCache || (pubCache = /* @__PURE__ */ new WeakMap());
    const cryptoKey = importAndCache(pubCache, key, key, alg, true);
    return cryptoKey;
  }
  return key;
}, "normalizePublicKey");
var normalizePrivateKey = /* @__PURE__ */ __name((key, alg) => {
  if (isKeyObject(key)) {
    let jwk = key.export({ format: "jwk" });
    if (jwk.k) {
      return exportKeyValue(jwk.k);
    }
    privCache || (privCache = /* @__PURE__ */ new WeakMap());
    return importAndCache(privCache, key, jwk, alg);
  }
  if (isJWK(key)) {
    if (key.k)
      return decode(key.k);
    privCache || (privCache = /* @__PURE__ */ new WeakMap());
    const cryptoKey = importAndCache(privCache, key, key, alg, true);
    return cryptoKey;
  }
  return key;
}, "normalizePrivateKey");
var normalize_key_default = { normalizePublicKey, normalizePrivateKey };

// node_modules/jose/dist/browser/key/import.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
async function importJWK(jwk, alg) {
  if (!isObject(jwk)) {
    throw new TypeError("JWK must be an object");
  }
  alg || (alg = jwk.alg);
  switch (jwk.kty) {
    case "oct":
      if (typeof jwk.k !== "string" || !jwk.k) {
        throw new TypeError('missing "k" (Key Value) Parameter value');
      }
      return decode(jwk.k);
    case "RSA":
      if ("oth" in jwk && jwk.oth !== void 0) {
        throw new JOSENotSupported('RSA JWK "oth" (Other Primes Info) Parameter value is not supported');
      }
    case "EC":
    case "OKP":
      return jwk_to_key_default({ ...jwk, alg });
    default:
      throw new JOSENotSupported('Unsupported "kty" (Key Type) Parameter value');
  }
}
__name(importJWK, "importJWK");

// node_modules/jose/dist/browser/lib/check_key_type.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var tag = /* @__PURE__ */ __name((key) => key?.[Symbol.toStringTag], "tag");
var jwkMatchesOp = /* @__PURE__ */ __name((alg, key, usage) => {
  if (key.use !== void 0 && key.use !== "sig") {
    throw new TypeError("Invalid key for this operation, when present its use must be sig");
  }
  if (key.key_ops !== void 0 && key.key_ops.includes?.(usage) !== true) {
    throw new TypeError(`Invalid key for this operation, when present its key_ops must include ${usage}`);
  }
  if (key.alg !== void 0 && key.alg !== alg) {
    throw new TypeError(`Invalid key for this operation, when present its alg must be ${alg}`);
  }
  return true;
}, "jwkMatchesOp");
var symmetricTypeCheck = /* @__PURE__ */ __name((alg, key, usage, allowJwk) => {
  if (key instanceof Uint8Array)
    return;
  if (allowJwk && isJWK(key)) {
    if (isSecretJWK(key) && jwkMatchesOp(alg, key, usage))
      return;
    throw new TypeError(`JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present`);
  }
  if (!is_key_like_default(key)) {
    throw new TypeError(withAlg(alg, key, ...types, "Uint8Array", allowJwk ? "JSON Web Key" : null));
  }
  if (key.type !== "secret") {
    throw new TypeError(`${tag(key)} instances for symmetric algorithms must be of type "secret"`);
  }
}, "symmetricTypeCheck");
var asymmetricTypeCheck = /* @__PURE__ */ __name((alg, key, usage, allowJwk) => {
  if (allowJwk && isJWK(key)) {
    switch (usage) {
      case "sign":
        if (isPrivateJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a private JWK`);
      case "verify":
        if (isPublicJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a public JWK`);
    }
  }
  if (!is_key_like_default(key)) {
    throw new TypeError(withAlg(alg, key, ...types, allowJwk ? "JSON Web Key" : null));
  }
  if (key.type === "secret") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithms must not be of type "secret"`);
  }
  if (usage === "sign" && key.type === "public") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm signing must be of type "private"`);
  }
  if (usage === "decrypt" && key.type === "public") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm decryption must be of type "private"`);
  }
  if (key.algorithm && usage === "verify" && key.type === "private") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm verifying must be of type "public"`);
  }
  if (key.algorithm && usage === "encrypt" && key.type === "private") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm encryption must be of type "public"`);
  }
}, "asymmetricTypeCheck");
function checkKeyType(allowJwk, alg, key, usage) {
  const symmetric = alg.startsWith("HS") || alg === "dir" || alg.startsWith("PBES2") || /^A\d{3}(?:GCM)?KW$/.test(alg);
  if (symmetric) {
    symmetricTypeCheck(alg, key, usage, allowJwk);
  } else {
    asymmetricTypeCheck(alg, key, usage, allowJwk);
  }
}
__name(checkKeyType, "checkKeyType");
var check_key_type_default = checkKeyType.bind(void 0, false);
var checkKeyTypeWithJwk = checkKeyType.bind(void 0, true);

// node_modules/jose/dist/browser/lib/validate_crit.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0) {
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  }
  if (!protectedHeader || protectedHeader.crit === void 0) {
    return /* @__PURE__ */ new Set();
  }
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input !== "string" || input.length === 0)) {
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  }
  let recognized;
  if (recognizedOption !== void 0) {
    recognized = new Map([...Object.entries(recognizedOption), ...recognizedDefault.entries()]);
  } else {
    recognized = recognizedDefault;
  }
  for (const parameter of protectedHeader.crit) {
    if (!recognized.has(parameter)) {
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    }
    if (joseHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    }
    if (recognized.get(parameter) && protectedHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
    }
  }
  return new Set(protectedHeader.crit);
}
__name(validateCrit, "validateCrit");
var validate_crit_default = validateCrit;

// node_modules/jose/dist/browser/lib/validate_algorithms.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var validateAlgorithms = /* @__PURE__ */ __name((option, algorithms) => {
  if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s2) => typeof s2 !== "string"))) {
    throw new TypeError(`"${option}" option must be an array of strings`);
  }
  if (!algorithms) {
    return void 0;
  }
  return new Set(algorithms);
}, "validateAlgorithms");
var validate_algorithms_default = validateAlgorithms;

// node_modules/jose/dist/browser/jws/compact/verify.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/jose/dist/browser/jws/flattened/verify.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/jose/dist/browser/runtime/verify.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/jose/dist/browser/runtime/subtle_dsa.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function subtleDsa(alg, algorithm) {
  const hash = `SHA-${alg.slice(-3)}`;
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512":
      return { hash, name: "HMAC" };
    case "PS256":
    case "PS384":
    case "PS512":
      return { hash, name: "RSA-PSS", saltLength: alg.slice(-3) >> 3 };
    case "RS256":
    case "RS384":
    case "RS512":
      return { hash, name: "RSASSA-PKCS1-v1_5" };
    case "ES256":
    case "ES384":
    case "ES512":
      return { hash, name: "ECDSA", namedCurve: algorithm.namedCurve };
    case "Ed25519":
      return { name: "Ed25519" };
    case "EdDSA":
      return { name: algorithm.name };
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
}
__name(subtleDsa, "subtleDsa");

// node_modules/jose/dist/browser/runtime/get_sign_verify_key.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
async function getCryptoKey(alg, key, usage) {
  if (usage === "sign") {
    key = await normalize_key_default.normalizePrivateKey(key, alg);
  }
  if (usage === "verify") {
    key = await normalize_key_default.normalizePublicKey(key, alg);
  }
  if (isCryptoKey(key)) {
    checkSigCryptoKey(key, alg, usage);
    return key;
  }
  if (key instanceof Uint8Array) {
    if (!alg.startsWith("HS")) {
      throw new TypeError(invalid_key_input_default(key, ...types));
    }
    return webcrypto_default.subtle.importKey("raw", key, { hash: `SHA-${alg.slice(-3)}`, name: "HMAC" }, false, [usage]);
  }
  throw new TypeError(invalid_key_input_default(key, ...types, "Uint8Array", "JSON Web Key"));
}
__name(getCryptoKey, "getCryptoKey");

// node_modules/jose/dist/browser/runtime/verify.js
var verify = /* @__PURE__ */ __name(async (alg, key, signature, data) => {
  const cryptoKey = await getCryptoKey(alg, key, "verify");
  check_key_length_default(alg, cryptoKey);
  const algorithm = subtleDsa(alg, cryptoKey.algorithm);
  try {
    return await webcrypto_default.subtle.verify(algorithm, cryptoKey, signature, data);
  } catch {
    return false;
  }
}, "verify");
var verify_default = verify;

// node_modules/jose/dist/browser/jws/flattened/verify.js
async function flattenedVerify(jws, key, options) {
  if (!isObject(jws)) {
    throw new JWSInvalid("Flattened JWS must be an object");
  }
  if (jws.protected === void 0 && jws.header === void 0) {
    throw new JWSInvalid('Flattened JWS must have either of the "protected" or "header" members');
  }
  if (jws.protected !== void 0 && typeof jws.protected !== "string") {
    throw new JWSInvalid("JWS Protected Header incorrect type");
  }
  if (jws.payload === void 0) {
    throw new JWSInvalid("JWS Payload missing");
  }
  if (typeof jws.signature !== "string") {
    throw new JWSInvalid("JWS Signature missing or incorrect type");
  }
  if (jws.header !== void 0 && !isObject(jws.header)) {
    throw new JWSInvalid("JWS Unprotected Header incorrect type");
  }
  let parsedProt = {};
  if (jws.protected) {
    try {
      const protectedHeader = decode(jws.protected);
      parsedProt = JSON.parse(decoder.decode(protectedHeader));
    } catch {
      throw new JWSInvalid("JWS Protected Header is invalid");
    }
  }
  if (!is_disjoint_default(parsedProt, jws.header)) {
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  }
  const joseHeader = {
    ...parsedProt,
    ...jws.header
  };
  const extensions = validate_crit_default(JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, parsedProt, joseHeader);
  let b64 = true;
  if (extensions.has("b64")) {
    b64 = parsedProt.b64;
    if (typeof b64 !== "boolean") {
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    }
  }
  const { alg } = joseHeader;
  if (typeof alg !== "string" || !alg) {
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  }
  const algorithms = options && validate_algorithms_default("algorithms", options.algorithms);
  if (algorithms && !algorithms.has(alg)) {
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  }
  if (b64) {
    if (typeof jws.payload !== "string") {
      throw new JWSInvalid("JWS Payload must be a string");
    }
  } else if (typeof jws.payload !== "string" && !(jws.payload instanceof Uint8Array)) {
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  }
  let resolvedKey = false;
  if (typeof key === "function") {
    key = await key(parsedProt, jws);
    resolvedKey = true;
    checkKeyTypeWithJwk(alg, key, "verify");
    if (isJWK(key)) {
      key = await importJWK(key, alg);
    }
  } else {
    checkKeyTypeWithJwk(alg, key, "verify");
  }
  const data = concat(encoder.encode(jws.protected ?? ""), encoder.encode("."), typeof jws.payload === "string" ? encoder.encode(jws.payload) : jws.payload);
  let signature;
  try {
    signature = decode(jws.signature);
  } catch {
    throw new JWSInvalid("Failed to base64url decode the signature");
  }
  const verified = await verify_default(alg, key, signature, data);
  if (!verified) {
    throw new JWSSignatureVerificationFailed();
  }
  let payload;
  if (b64) {
    try {
      payload = decode(jws.payload);
    } catch {
      throw new JWSInvalid("Failed to base64url decode the payload");
    }
  } else if (typeof jws.payload === "string") {
    payload = encoder.encode(jws.payload);
  } else {
    payload = jws.payload;
  }
  const result = { payload };
  if (jws.protected !== void 0) {
    result.protectedHeader = parsedProt;
  }
  if (jws.header !== void 0) {
    result.unprotectedHeader = jws.header;
  }
  if (resolvedKey) {
    return { ...result, key };
  }
  return result;
}
__name(flattenedVerify, "flattenedVerify");

// node_modules/jose/dist/browser/jws/compact/verify.js
async function compactVerify(jws, key, options) {
  if (jws instanceof Uint8Array) {
    jws = decoder.decode(jws);
  }
  if (typeof jws !== "string") {
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  }
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3) {
    throw new JWSInvalid("Invalid Compact JWS");
  }
  const verified = await flattenedVerify({ payload, protected: protectedHeader, signature }, key, options);
  const result = { payload: verified.payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}
__name(compactVerify, "compactVerify");

// node_modules/jose/dist/browser/jwt/verify.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/jose/dist/browser/lib/jwt_claims_set.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/jose/dist/browser/lib/epoch.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var epoch_default = /* @__PURE__ */ __name((date) => Math.floor(date.getTime() / 1e3), "default");

// node_modules/jose/dist/browser/lib/secs.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var minute = 60;
var hour = minute * 60;
var day = hour * 24;
var week = day * 7;
var year = day * 365.25;
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
var secs_default = /* @__PURE__ */ __name((str) => {
  const matched = REGEX.exec(str);
  if (!matched || matched[4] && matched[1]) {
    throw new TypeError("Invalid time period format");
  }
  const value = parseFloat(matched[2]);
  const unit = matched[3].toLowerCase();
  let numericDate;
  switch (unit) {
    case "sec":
    case "secs":
    case "second":
    case "seconds":
    case "s":
      numericDate = Math.round(value);
      break;
    case "minute":
    case "minutes":
    case "min":
    case "mins":
    case "m":
      numericDate = Math.round(value * minute);
      break;
    case "hour":
    case "hours":
    case "hr":
    case "hrs":
    case "h":
      numericDate = Math.round(value * hour);
      break;
    case "day":
    case "days":
    case "d":
      numericDate = Math.round(value * day);
      break;
    case "week":
    case "weeks":
    case "w":
      numericDate = Math.round(value * week);
      break;
    default:
      numericDate = Math.round(value * year);
      break;
  }
  if (matched[1] === "-" || matched[4] === "ago") {
    return -numericDate;
  }
  return numericDate;
}, "default");

// node_modules/jose/dist/browser/lib/jwt_claims_set.js
var normalizeTyp = /* @__PURE__ */ __name((value) => value.toLowerCase().replace(/^application\//, ""), "normalizeTyp");
var checkAudiencePresence = /* @__PURE__ */ __name((audPayload, audOption) => {
  if (typeof audPayload === "string") {
    return audOption.includes(audPayload);
  }
  if (Array.isArray(audPayload)) {
    return audOption.some(Set.prototype.has.bind(new Set(audPayload)));
  }
  return false;
}, "checkAudiencePresence");
var jwt_claims_set_default = /* @__PURE__ */ __name((protectedHeader, encodedPayload, options = {}) => {
  let payload;
  try {
    payload = JSON.parse(decoder.decode(encodedPayload));
  } catch {
  }
  if (!isObject(payload)) {
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  }
  const { typ } = options;
  if (typ && (typeof protectedHeader.typ !== "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ))) {
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", "check_failed");
  }
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options;
  const presenceCheck = [...requiredClaims];
  if (maxTokenAge !== void 0)
    presenceCheck.push("iat");
  if (audience !== void 0)
    presenceCheck.push("aud");
  if (subject !== void 0)
    presenceCheck.push("sub");
  if (issuer !== void 0)
    presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse())) {
    if (!(claim in payload)) {
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
    }
  }
  if (issuer && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss)) {
    throw new JWTClaimValidationFailed('unexpected "iss" claim value', payload, "iss", "check_failed");
  }
  if (subject && payload.sub !== subject) {
    throw new JWTClaimValidationFailed('unexpected "sub" claim value', payload, "sub", "check_failed");
  }
  if (audience && !checkAudiencePresence(payload.aud, typeof audience === "string" ? [audience] : audience)) {
    throw new JWTClaimValidationFailed('unexpected "aud" claim value', payload, "aud", "check_failed");
  }
  let tolerance;
  switch (typeof options.clockTolerance) {
    case "string":
      tolerance = secs_default(options.clockTolerance);
      break;
    case "number":
      tolerance = options.clockTolerance;
      break;
    case "undefined":
      tolerance = 0;
      break;
    default:
      throw new TypeError("Invalid clockTolerance option type");
  }
  const { currentDate } = options;
  const now = epoch_default(currentDate || /* @__PURE__ */ new Date());
  if ((payload.iat !== void 0 || maxTokenAge) && typeof payload.iat !== "number") {
    throw new JWTClaimValidationFailed('"iat" claim must be a number', payload, "iat", "invalid");
  }
  if (payload.nbf !== void 0) {
    if (typeof payload.nbf !== "number") {
      throw new JWTClaimValidationFailed('"nbf" claim must be a number', payload, "nbf", "invalid");
    }
    if (payload.nbf > now + tolerance) {
      throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", "check_failed");
    }
  }
  if (payload.exp !== void 0) {
    if (typeof payload.exp !== "number") {
      throw new JWTClaimValidationFailed('"exp" claim must be a number', payload, "exp", "invalid");
    }
    if (payload.exp <= now - tolerance) {
      throw new JWTExpired('"exp" claim timestamp check failed', payload, "exp", "check_failed");
    }
  }
  if (maxTokenAge) {
    const age = now - payload.iat;
    const max = typeof maxTokenAge === "number" ? maxTokenAge : secs_default(maxTokenAge);
    if (age - tolerance > max) {
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", "check_failed");
    }
    if (age < 0 - tolerance) {
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", "check_failed");
    }
  }
  return payload;
}, "default");

// node_modules/jose/dist/browser/jwt/verify.js
async function jwtVerify(jwt, key, options) {
  const verified = await compactVerify(jwt, key, options);
  if (verified.protectedHeader.crit?.includes("b64") && verified.protectedHeader.b64 === false) {
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  }
  const payload = jwt_claims_set_default(verified.protectedHeader, verified.payload, options);
  const result = { payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}
__name(jwtVerify, "jwtVerify");

// node_modules/jose/dist/browser/jws/compact/sign.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/jose/dist/browser/jws/flattened/sign.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/jose/dist/browser/runtime/sign.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var sign = /* @__PURE__ */ __name(async (alg, key, data) => {
  const cryptoKey = await getCryptoKey(alg, key, "sign");
  check_key_length_default(alg, cryptoKey);
  const signature = await webcrypto_default.subtle.sign(subtleDsa(alg, cryptoKey.algorithm), cryptoKey, data);
  return new Uint8Array(signature);
}, "sign");
var sign_default = sign;

// node_modules/jose/dist/browser/jws/flattened/sign.js
var FlattenedSign = class {
  static {
    __name(this, "FlattenedSign");
  }
  constructor(payload) {
    if (!(payload instanceof Uint8Array)) {
      throw new TypeError("payload must be an instance of Uint8Array");
    }
    this._payload = payload;
  }
  setProtectedHeader(protectedHeader) {
    if (this._protectedHeader) {
      throw new TypeError("setProtectedHeader can only be called once");
    }
    this._protectedHeader = protectedHeader;
    return this;
  }
  setUnprotectedHeader(unprotectedHeader) {
    if (this._unprotectedHeader) {
      throw new TypeError("setUnprotectedHeader can only be called once");
    }
    this._unprotectedHeader = unprotectedHeader;
    return this;
  }
  async sign(key, options) {
    if (!this._protectedHeader && !this._unprotectedHeader) {
      throw new JWSInvalid("either setProtectedHeader or setUnprotectedHeader must be called before #sign()");
    }
    if (!is_disjoint_default(this._protectedHeader, this._unprotectedHeader)) {
      throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
    }
    const joseHeader = {
      ...this._protectedHeader,
      ...this._unprotectedHeader
    };
    const extensions = validate_crit_default(JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, this._protectedHeader, joseHeader);
    let b64 = true;
    if (extensions.has("b64")) {
      b64 = this._protectedHeader.b64;
      if (typeof b64 !== "boolean") {
        throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
      }
    }
    const { alg } = joseHeader;
    if (typeof alg !== "string" || !alg) {
      throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
    }
    checkKeyTypeWithJwk(alg, key, "sign");
    let payload = this._payload;
    if (b64) {
      payload = encoder.encode(encode(payload));
    }
    let protectedHeader;
    if (this._protectedHeader) {
      protectedHeader = encoder.encode(encode(JSON.stringify(this._protectedHeader)));
    } else {
      protectedHeader = encoder.encode("");
    }
    const data = concat(protectedHeader, encoder.encode("."), payload);
    const signature = await sign_default(alg, key, data);
    const jws = {
      signature: encode(signature),
      payload: ""
    };
    if (b64) {
      jws.payload = decoder.decode(payload);
    }
    if (this._unprotectedHeader) {
      jws.header = this._unprotectedHeader;
    }
    if (this._protectedHeader) {
      jws.protected = decoder.decode(protectedHeader);
    }
    return jws;
  }
};

// node_modules/jose/dist/browser/jws/compact/sign.js
var CompactSign = class {
  static {
    __name(this, "CompactSign");
  }
  constructor(payload) {
    this._flattened = new FlattenedSign(payload);
  }
  setProtectedHeader(protectedHeader) {
    this._flattened.setProtectedHeader(protectedHeader);
    return this;
  }
  async sign(key, options) {
    const jws = await this._flattened.sign(key, options);
    if (jws.payload === void 0) {
      throw new TypeError("use the flattened module for creating JWS with b64: false");
    }
    return `${jws.protected}.${jws.payload}.${jws.signature}`;
  }
};

// node_modules/jose/dist/browser/jwt/sign.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/jose/dist/browser/jwt/produce.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function validateInput(label, input) {
  if (!Number.isFinite(input)) {
    throw new TypeError(`Invalid ${label} input`);
  }
  return input;
}
__name(validateInput, "validateInput");
var ProduceJWT = class {
  static {
    __name(this, "ProduceJWT");
  }
  constructor(payload = {}) {
    if (!isObject(payload)) {
      throw new TypeError("JWT Claims Set MUST be an object");
    }
    this._payload = payload;
  }
  setIssuer(issuer) {
    this._payload = { ...this._payload, iss: issuer };
    return this;
  }
  setSubject(subject) {
    this._payload = { ...this._payload, sub: subject };
    return this;
  }
  setAudience(audience) {
    this._payload = { ...this._payload, aud: audience };
    return this;
  }
  setJti(jwtId) {
    this._payload = { ...this._payload, jti: jwtId };
    return this;
  }
  setNotBefore(input) {
    if (typeof input === "number") {
      this._payload = { ...this._payload, nbf: validateInput("setNotBefore", input) };
    } else if (input instanceof Date) {
      this._payload = { ...this._payload, nbf: validateInput("setNotBefore", epoch_default(input)) };
    } else {
      this._payload = { ...this._payload, nbf: epoch_default(/* @__PURE__ */ new Date()) + secs_default(input) };
    }
    return this;
  }
  setExpirationTime(input) {
    if (typeof input === "number") {
      this._payload = { ...this._payload, exp: validateInput("setExpirationTime", input) };
    } else if (input instanceof Date) {
      this._payload = { ...this._payload, exp: validateInput("setExpirationTime", epoch_default(input)) };
    } else {
      this._payload = { ...this._payload, exp: epoch_default(/* @__PURE__ */ new Date()) + secs_default(input) };
    }
    return this;
  }
  setIssuedAt(input) {
    if (typeof input === "undefined") {
      this._payload = { ...this._payload, iat: epoch_default(/* @__PURE__ */ new Date()) };
    } else if (input instanceof Date) {
      this._payload = { ...this._payload, iat: validateInput("setIssuedAt", epoch_default(input)) };
    } else if (typeof input === "string") {
      this._payload = {
        ...this._payload,
        iat: validateInput("setIssuedAt", epoch_default(/* @__PURE__ */ new Date()) + secs_default(input))
      };
    } else {
      this._payload = { ...this._payload, iat: validateInput("setIssuedAt", input) };
    }
    return this;
  }
};

// node_modules/jose/dist/browser/jwt/sign.js
var SignJWT = class extends ProduceJWT {
  static {
    __name(this, "SignJWT");
  }
  setProtectedHeader(protectedHeader) {
    this._protectedHeader = protectedHeader;
    return this;
  }
  async sign(key, options) {
    const sig = new CompactSign(encoder.encode(JSON.stringify(this._payload)));
    sig.setProtectedHeader(this._protectedHeader);
    if (Array.isArray(this._protectedHeader?.crit) && this._protectedHeader.crit.includes("b64") && this._protectedHeader.b64 === false) {
      throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
    }
    return sig.sign(key, options);
  }
};

// src/auth.ts
var JWT_ALGORITHM = "HS256";
var JWT_EXPIRY_HOURS = 24;
function getSecretKey(env2) {
  return new TextEncoder().encode(env2.JWT_SECRET);
}
__name(getSecretKey, "getSecretKey");
async function createJWT(env2, userId, email, role, impersonatedBy) {
  const payload = {
    user_id: userId,
    email,
    role
  };
  if (impersonatedBy) payload.impersonated_by = impersonatedBy;
  return new SignJWT(payload).setProtectedHeader({ alg: JWT_ALGORITHM }).setIssuedAt().setExpirationTime(`${JWT_EXPIRY_HOURS}h`).sign(getSecretKey(env2));
}
__name(createJWT, "createJWT");
async function decodeJWT(env2, token) {
  const { payload } = await jwtVerify(token, getSecretKey(env2), { algorithms: [JWT_ALGORITHM] });
  return payload;
}
__name(decodeJWT, "decodeJWT");
async function getCurrentUser(c2) {
  const authHeader = c2.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.split(" ")[1];
  try {
    const payload = await decodeJWT(c2.env, token);
    const sql = getSQL(c2.env);
    const users2 = await sql`SELECT * FROM users WHERE id = ${payload.user_id}`;
    await sql.end();
    if (users2.length === 0 || !users2[0].is_active) return null;
    return users2[0];
  } catch {
    return null;
  }
}
__name(getCurrentUser, "getCurrentUser");
async function requireAuth(c2) {
  const user = await getCurrentUser(c2);
  if (!user) throw new Error("Unauthorized");
  return user;
}
__name(requireAuth, "requireAuth");
async function requireAdmin(c2) {
  const user = await requireAuth(c2);
  if (user.role !== "admin") throw new Error("Admin required");
  return user;
}
__name(requireAdmin, "requireAdmin");
async function hashToken(token) {
  const encoder2 = new TextEncoder();
  const data = encoder2.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashToken, "hashToken");
function generateToken() {
  const bytes = new Uint8Array(36);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(36)).join("").slice(0, 48);
}
__name(generateToken, "generateToken");

// src/routes/auth.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/otpauth/dist/otpauth.esm.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var uintDecode = /* @__PURE__ */ __name((num) => {
  const buf = new ArrayBuffer(8);
  const arr = new Uint8Array(buf);
  let acc = num;
  for (let i2 = 7; i2 >= 0; i2--) {
    if (acc === 0) break;
    arr[i2] = acc & 255;
    acc -= arr[i2];
    acc /= 256;
  }
  return arr;
}, "uintDecode");
function isBytes(a2) {
  return a2 instanceof Uint8Array || ArrayBuffer.isView(a2) && a2.constructor.name === "Uint8Array";
}
__name(isBytes, "isBytes");
function anumber(n2, title2 = "") {
  if (!Number.isSafeInteger(n2) || n2 < 0) {
    const prefix = title2 && `"${title2}" `;
    throw new Error(`${prefix}expected integer >= 0, got ${n2}`);
  }
}
__name(anumber, "anumber");
function abytes(value, length, title2 = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title2 && `"${title2}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
__name(abytes, "abytes");
function ahash(h2) {
  if (typeof h2 !== "function" || typeof h2.create !== "function") throw new Error("Hash must wrapped by utils.createHasher");
  anumber(h2.outputLen);
  anumber(h2.blockLen);
}
__name(ahash, "ahash");
function aexists(instance, checkFinished = true) {
  if (instance.destroyed) throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished) throw new Error("Hash#digest() has already been called");
}
__name(aexists, "aexists");
function aoutput(out, instance) {
  abytes(out, void 0, "digestInto() output");
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error('"digestInto() output" expected to be of length >=' + min);
  }
}
__name(aoutput, "aoutput");
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
__name(u32, "u32");
function clean(...arrays) {
  for (let i2 = 0; i2 < arrays.length; i2++) {
    arrays[i2].fill(0);
  }
}
__name(clean, "clean");
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
__name(createView, "createView");
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
__name(rotr, "rotr");
function rotl(word, shift) {
  return word << shift | word >>> 32 - shift >>> 0;
}
__name(rotl, "rotl");
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([
  287454020
]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
__name(byteSwap, "byteSwap");
function byteSwap32(arr) {
  for (let i2 = 0; i2 < arr.length; i2++) {
    arr[i2] = byteSwap(arr[i2]);
  }
  return arr;
}
__name(byteSwap32, "byteSwap32");
var swap32IfBE = isLE ? (u) => u : byteSwap32;
function createHasher(hashCons, info3 = {}) {
  const hashC = /* @__PURE__ */ __name((msg, opts) => hashCons(opts).update(msg).digest(), "hashC");
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info3);
  return Object.freeze(hashC);
}
__name(createHasher, "createHasher");
var oidNist = /* @__PURE__ */ __name((suffix) => ({
  oid: Uint8Array.from([
    6,
    9,
    96,
    134,
    72,
    1,
    101,
    3,
    4,
    2,
    suffix
  ])
}), "oidNist");
var _HMAC = class {
  static {
    __name(this, "_HMAC");
  }
  update(buf) {
    aexists(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists(this);
    abytes(out, this.outputLen, "output");
    this.finished = true;
    this.iHash.digestInto(out);
    this.oHash.update(out);
    this.oHash.digestInto(out);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to || (to = Object.create(Object.getPrototypeOf(this), {}));
    const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
  constructor(hash, key) {
    this.finished = false;
    this.destroyed = false;
    ahash(hash);
    abytes(key, void 0, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function") throw new Error("Expected instance of class which extends utils.Hash");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i2 = 0; i2 < pad.length; i2++) pad[i2] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i2 = 0; i2 < pad.length; i2++) pad[i2] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean(pad);
  }
};
var hmac = /* @__PURE__ */ __name((hash, key, message2) => new _HMAC(hash, key).update(message2).digest(), "hmac");
hmac.create = (hash, key) => new _HMAC(hash, key);
function Chi(a2, b, c2) {
  return a2 & b ^ ~a2 & c2;
}
__name(Chi, "Chi");
function Maj(a2, b, c2) {
  return a2 & b ^ a2 & c2 ^ b & c2;
}
__name(Maj, "Maj");
var HashMD = class {
  static {
    __name(this, "HashMD");
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen) this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE2 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i2 = pos; i2 < blockLen; i2++) buffer[i2] = 0;
    view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE2);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4) throw new Error("_sha2: outputLen must be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length) throw new Error("_sha2: outputLen bigger than state");
    for (let i2 = 0; i2 < outLen; i2++) oview.setUint32(4 * i2, state[i2], isLE2);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen) to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  constructor(blockLen, outputLen, padOffset, isLE2) {
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE2;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA224_IV = /* @__PURE__ */ Uint32Array.from([
  3238371032,
  914150663,
  812702999,
  4144912697,
  4290775857,
  1750603025,
  1694076839,
  3204075428
]);
var SHA384_IV = /* @__PURE__ */ Uint32Array.from([
  3418070365,
  3238371032,
  1654270250,
  914150663,
  2438529370,
  812702999,
  355462360,
  4144912697,
  1731405415,
  4290775857,
  2394180231,
  1750603025,
  3675008525,
  1694076839,
  1203062813,
  3204075428
]);
var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);
var SHA1_IV = /* @__PURE__ */ Uint32Array.from([
  1732584193,
  4023233417,
  2562383102,
  271733878,
  3285377520
]);
var SHA1_W = /* @__PURE__ */ new Uint32Array(80);
var _SHA1 = class extends HashMD {
  static {
    __name(this, "_SHA1");
  }
  get() {
    const { A, B, C, D, E } = this;
    return [
      A,
      B,
      C,
      D,
      E
    ];
  }
  set(A, B, C, D, E) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
  }
  process(view, offset) {
    for (let i2 = 0; i2 < 16; i2++, offset += 4) SHA1_W[i2] = view.getUint32(offset, false);
    for (let i2 = 16; i2 < 80; i2++) SHA1_W[i2] = rotl(SHA1_W[i2 - 3] ^ SHA1_W[i2 - 8] ^ SHA1_W[i2 - 14] ^ SHA1_W[i2 - 16], 1);
    let { A, B, C, D, E } = this;
    for (let i2 = 0; i2 < 80; i2++) {
      let F, K;
      if (i2 < 20) {
        F = Chi(B, C, D);
        K = 1518500249;
      } else if (i2 < 40) {
        F = B ^ C ^ D;
        K = 1859775393;
      } else if (i2 < 60) {
        F = Maj(B, C, D);
        K = 2400959708;
      } else {
        F = B ^ C ^ D;
        K = 3395469782;
      }
      const T = rotl(A, 5) + F + E + K + SHA1_W[i2] | 0;
      E = D;
      D = C;
      C = rotl(B, 30);
      B = A;
      A = T;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    this.set(A, B, C, D, E);
  }
  roundClean() {
    clean(SHA1_W);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0);
    clean(this.buffer);
  }
  constructor() {
    super(64, 20, 8, false), this.A = SHA1_IV[0] | 0, this.B = SHA1_IV[1] | 0, this.C = SHA1_IV[2] | 0, this.D = SHA1_IV[3] | 0, this.E = SHA1_IV[4] | 0;
  }
};
var sha1 = /* @__PURE__ */ createHasher(() => new _SHA1());
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n2, le = false) {
  if (le) return {
    h: Number(n2 & U32_MASK64),
    l: Number(n2 >> _32n & U32_MASK64)
  };
  return {
    h: Number(n2 >> _32n & U32_MASK64) | 0,
    l: Number(n2 & U32_MASK64) | 0
  };
}
__name(fromBig, "fromBig");
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i2 = 0; i2 < len; i2++) {
    const { h: h2, l } = fromBig(lst[i2], le);
    [Ah[i2], Al[i2]] = [
      h2,
      l
    ];
  }
  return [
    Ah,
    Al
  ];
}
__name(split, "split");
var shrSH = /* @__PURE__ */ __name((h2, _l, s2) => h2 >>> s2, "shrSH");
var shrSL = /* @__PURE__ */ __name((h2, l, s2) => h2 << 32 - s2 | l >>> s2, "shrSL");
var rotrSH = /* @__PURE__ */ __name((h2, l, s2) => h2 >>> s2 | l << 32 - s2, "rotrSH");
var rotrSL = /* @__PURE__ */ __name((h2, l, s2) => h2 << 32 - s2 | l >>> s2, "rotrSL");
var rotrBH = /* @__PURE__ */ __name((h2, l, s2) => h2 << 64 - s2 | l >>> s2 - 32, "rotrBH");
var rotrBL = /* @__PURE__ */ __name((h2, l, s2) => h2 >>> s2 - 32 | l << 64 - s2, "rotrBL");
var rotlSH = /* @__PURE__ */ __name((h2, l, s2) => h2 << s2 | l >>> 32 - s2, "rotlSH");
var rotlSL = /* @__PURE__ */ __name((h2, l, s2) => l << s2 | h2 >>> 32 - s2, "rotlSL");
var rotlBH = /* @__PURE__ */ __name((h2, l, s2) => l << s2 - 32 | h2 >>> 64 - s2, "rotlBH");
var rotlBL = /* @__PURE__ */ __name((h2, l, s2) => h2 << s2 - 32 | l >>> 64 - s2, "rotlBL");
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return {
    h: Ah + Bh + (l / 2 ** 32 | 0) | 0,
    l: l | 0
  };
}
__name(add, "add");
var add3L = /* @__PURE__ */ __name((Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0), "add3L");
var add3H = /* @__PURE__ */ __name((low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0, "add3H");
var add4L = /* @__PURE__ */ __name((Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0), "add4L");
var add4H = /* @__PURE__ */ __name((low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0, "add4H");
var add5L = /* @__PURE__ */ __name((Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0), "add5L");
var add5H = /* @__PURE__ */ __name((low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0, "add5H");
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  static {
    __name(this, "SHA2_32B");
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [
      A,
      B,
      C,
      D,
      E,
      F,
      G,
      H
    ];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i2 = 0; i2 < 16; i2++, offset += 4) SHA256_W[i2] = view.getUint32(offset, false);
    for (let i2 = 16; i2 < 64; i2++) {
      const W15 = SHA256_W[i2 - 15];
      const W2 = SHA256_W[i2 - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i2] = s1 + SHA256_W[i2 - 7] + s0 + SHA256_W[i2 - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i2 = 0; i2 < 64; i2++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i2] + SHA256_W[i2] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
  constructor(outputLen) {
    super(64, outputLen, 8, false);
  }
};
var _SHA256 = class extends SHA2_32B {
  static {
    __name(this, "_SHA256");
  }
  constructor() {
    super(32), // We cannot use array here since array allows indexing by variable
    // which means optimizer/compiler cannot use registers.
    this.A = SHA256_IV[0] | 0, this.B = SHA256_IV[1] | 0, this.C = SHA256_IV[2] | 0, this.D = SHA256_IV[3] | 0, this.E = SHA256_IV[4] | 0, this.F = SHA256_IV[5] | 0, this.G = SHA256_IV[6] | 0, this.H = SHA256_IV[7] | 0;
  }
};
var _SHA224 = class extends SHA2_32B {
  static {
    __name(this, "_SHA224");
  }
  constructor() {
    super(28), this.A = SHA224_IV[0] | 0, this.B = SHA224_IV[1] | 0, this.C = SHA224_IV[2] | 0, this.D = SHA224_IV[3] | 0, this.E = SHA224_IV[4] | 0, this.F = SHA224_IV[5] | 0, this.G = SHA224_IV[6] | 0, this.H = SHA224_IV[7] | 0;
  }
};
var K512 = /* @__PURE__ */ (() => split([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n2) => BigInt(n2))))();
var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
var SHA2_64B = class extends HashMD {
  static {
    __name(this, "SHA2_64B");
  }
  // prettier-ignore
  get() {
    const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [
      Ah,
      Al,
      Bh,
      Bl,
      Ch,
      Cl,
      Dh,
      Dl,
      Eh,
      El,
      Fh,
      Fl,
      Gh,
      Gl,
      Hh,
      Hl
    ];
  }
  // prettier-ignore
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0;
    this.Al = Al | 0;
    this.Bh = Bh | 0;
    this.Bl = Bl | 0;
    this.Ch = Ch | 0;
    this.Cl = Cl | 0;
    this.Dh = Dh | 0;
    this.Dl = Dl | 0;
    this.Eh = Eh | 0;
    this.El = El | 0;
    this.Fh = Fh | 0;
    this.Fl = Fl | 0;
    this.Gh = Gh | 0;
    this.Gl = Gl | 0;
    this.Hh = Hh | 0;
    this.Hl = Hl | 0;
  }
  process(view, offset) {
    for (let i2 = 0; i2 < 16; i2++, offset += 4) {
      SHA512_W_H[i2] = view.getUint32(offset);
      SHA512_W_L[i2] = view.getUint32(offset += 4);
    }
    for (let i2 = 16; i2 < 80; i2++) {
      const W15h = SHA512_W_H[i2 - 15] | 0;
      const W15l = SHA512_W_L[i2 - 15] | 0;
      const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
      const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
      const W2h = SHA512_W_H[i2 - 2] | 0;
      const W2l = SHA512_W_L[i2 - 2] | 0;
      const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
      const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
      const SUMl = add4L(s0l, s1l, SHA512_W_L[i2 - 7], SHA512_W_L[i2 - 16]);
      const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i2 - 7], SHA512_W_H[i2 - 16]);
      SHA512_W_H[i2] = SUMh | 0;
      SHA512_W_L[i2] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i2 = 0; i2 < 80; i2++) {
      const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
      const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
      const CHIh = Eh & Fh ^ ~Eh & Gh;
      const CHIl = El & Fl ^ ~El & Gl;
      const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i2], SHA512_W_L[i2]);
      const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i2], SHA512_W_H[i2]);
      const T1l = T1ll | 0;
      const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
      const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
      const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
      const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0;
      Hl = Gl | 0;
      Gh = Fh | 0;
      Gl = Fl | 0;
      Fh = Eh | 0;
      Fl = El | 0;
      ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
      Dh = Ch | 0;
      Dl = Cl | 0;
      Ch = Bh | 0;
      Cl = Bl | 0;
      Bh = Ah | 0;
      Bl = Al | 0;
      const All = add3L(T1l, sigma0l, MAJl);
      Ah = add3H(All, T1h, sigma0h, MAJh);
      Al = All | 0;
    }
    ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
    this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean(SHA512_W_H, SHA512_W_L);
  }
  destroy() {
    clean(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  constructor(outputLen) {
    super(128, outputLen, 16, false);
  }
};
var _SHA512 = class extends SHA2_64B {
  static {
    __name(this, "_SHA512");
  }
  constructor() {
    super(64), this.Ah = SHA512_IV[0] | 0, this.Al = SHA512_IV[1] | 0, this.Bh = SHA512_IV[2] | 0, this.Bl = SHA512_IV[3] | 0, this.Ch = SHA512_IV[4] | 0, this.Cl = SHA512_IV[5] | 0, this.Dh = SHA512_IV[6] | 0, this.Dl = SHA512_IV[7] | 0, this.Eh = SHA512_IV[8] | 0, this.El = SHA512_IV[9] | 0, this.Fh = SHA512_IV[10] | 0, this.Fl = SHA512_IV[11] | 0, this.Gh = SHA512_IV[12] | 0, this.Gl = SHA512_IV[13] | 0, this.Hh = SHA512_IV[14] | 0, this.Hl = SHA512_IV[15] | 0;
  }
};
var _SHA384 = class extends SHA2_64B {
  static {
    __name(this, "_SHA384");
  }
  constructor() {
    super(48), this.Ah = SHA384_IV[0] | 0, this.Al = SHA384_IV[1] | 0, this.Bh = SHA384_IV[2] | 0, this.Bl = SHA384_IV[3] | 0, this.Ch = SHA384_IV[4] | 0, this.Cl = SHA384_IV[5] | 0, this.Dh = SHA384_IV[6] | 0, this.Dl = SHA384_IV[7] | 0, this.Eh = SHA384_IV[8] | 0, this.El = SHA384_IV[9] | 0, this.Fh = SHA384_IV[10] | 0, this.Fl = SHA384_IV[11] | 0, this.Gh = SHA384_IV[12] | 0, this.Gl = SHA384_IV[13] | 0, this.Hh = SHA384_IV[14] | 0, this.Hl = SHA384_IV[15] | 0;
  }
};
var sha256 = /* @__PURE__ */ createHasher(() => new _SHA256(), /* @__PURE__ */ oidNist(1));
var sha224 = /* @__PURE__ */ createHasher(() => new _SHA224(), /* @__PURE__ */ oidNist(4));
var sha512 = /* @__PURE__ */ createHasher(() => new _SHA512(), /* @__PURE__ */ oidNist(3));
var sha384 = /* @__PURE__ */ createHasher(() => new _SHA384(), /* @__PURE__ */ oidNist(2));
var _0n = BigInt(0);
var _1n = BigInt(1);
var _2n = BigInt(2);
var _7n = BigInt(7);
var _256n = BigInt(256);
var _0x71n = BigInt(113);
var SHA3_PI = [];
var SHA3_ROTL = [];
var _SHA3_IOTA = [];
for (let round = 0, R = _1n, x = 1, y = 0; round < 24; round++) {
  [x, y] = [
    y,
    (2 * x + 3 * y) % 5
  ];
  SHA3_PI.push(2 * (5 * y + x));
  SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
  let t = _0n;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n ^ (R >> _7n) * _0x71n) % _256n;
    if (R & _2n) t ^= _1n << (_1n << BigInt(j)) - _1n;
  }
  _SHA3_IOTA.push(t);
}
var IOTAS = split(_SHA3_IOTA, true);
var SHA3_IOTA_H = IOTAS[0];
var SHA3_IOTA_L = IOTAS[1];
var rotlH = /* @__PURE__ */ __name((h2, l, s2) => s2 > 32 ? rotlBH(h2, l, s2) : rotlSH(h2, l, s2), "rotlH");
var rotlL = /* @__PURE__ */ __name((h2, l, s2) => s2 > 32 ? rotlBL(h2, l, s2) : rotlSL(h2, l, s2), "rotlL");
function keccakP(s2, rounds = 24) {
  const B = new Uint32Array(5 * 2);
  for (let round = 24 - rounds; round < 24; round++) {
    for (let x = 0; x < 10; x++) B[x] = s2[x] ^ s2[x + 10] ^ s2[x + 20] ^ s2[x + 30] ^ s2[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s2[x + y] ^= Th;
        s2[x + y + 1] ^= Tl;
      }
    }
    let curH = s2[2];
    let curL = s2[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL[t];
      const Th = rotlH(curH, curL, shift);
      const Tl = rotlL(curH, curL, shift);
      const PI = SHA3_PI[t];
      curH = s2[PI];
      curL = s2[PI + 1];
      s2[PI] = Th;
      s2[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      for (let x = 0; x < 10; x++) B[x] = s2[y + x];
      for (let x = 0; x < 10; x++) s2[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
    }
    s2[0] ^= SHA3_IOTA_H[round];
    s2[1] ^= SHA3_IOTA_L[round];
  }
  clean(B);
}
__name(keccakP, "keccakP");
var Keccak = class _Keccak {
  static {
    __name(this, "Keccak");
  }
  clone() {
    return this._cloneInto();
  }
  keccak() {
    swap32IfBE(this.state32);
    keccakP(this.state32, this.rounds);
    swap32IfBE(this.state32);
    this.posOut = 0;
    this.pos = 0;
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { blockLen, state } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i2 = 0; i2 < take; i2++) state[this.pos++] ^= data[pos++];
      if (this.pos === blockLen) this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    const { state, suffix, pos, blockLen } = this;
    state[pos] ^= suffix;
    if ((suffix & 128) !== 0 && pos === blockLen - 1) this.keccak();
    state[blockLen - 1] ^= 128;
    this.keccak();
  }
  writeInto(out) {
    aexists(this, false);
    abytes(out);
    this.finish();
    const bufferOut = this.state;
    const { blockLen } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen) this.keccak();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF) throw new Error("XOF is not possible for this instance");
    return this.writeInto(out);
  }
  xof(bytes) {
    anumber(bytes);
    return this.xofInto(new Uint8Array(bytes));
  }
  digestInto(out) {
    aoutput(out, this);
    if (this.finished) throw new Error("digest() was already called");
    this.writeInto(out);
    this.destroy();
    return out;
  }
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
  destroy() {
    this.destroyed = true;
    clean(this.state);
  }
  _cloneInto(to) {
    const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
    to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds));
    to.state32.set(this.state32);
    to.pos = this.pos;
    to.posOut = this.posOut;
    to.finished = this.finished;
    to.rounds = rounds;
    to.suffix = suffix;
    to.outputLen = outputLen;
    to.enableXOF = enableXOF;
    to.destroyed = this.destroyed;
    return to;
  }
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
    this.pos = 0;
    this.posOut = 0;
    this.finished = false;
    this.destroyed = false;
    this.enableXOF = false;
    this.blockLen = blockLen;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.enableXOF = enableXOF;
    this.rounds = rounds;
    anumber(outputLen, "outputLen");
    if (!(0 < blockLen && blockLen < 200)) throw new Error("only keccak-f1600 function is supported");
    this.state = new Uint8Array(200);
    this.state32 = u32(this.state);
  }
};
var genKeccak = /* @__PURE__ */ __name((suffix, blockLen, outputLen, info3 = {}) => createHasher(() => new Keccak(blockLen, suffix, outputLen), info3), "genKeccak");
var sha3_224 = /* @__PURE__ */ genKeccak(6, 144, 28, /* @__PURE__ */ oidNist(7));
var sha3_256 = /* @__PURE__ */ genKeccak(6, 136, 32, /* @__PURE__ */ oidNist(8));
var sha3_384 = /* @__PURE__ */ genKeccak(6, 104, 48, /* @__PURE__ */ oidNist(9));
var sha3_512 = /* @__PURE__ */ genKeccak(6, 72, 64, /* @__PURE__ */ oidNist(10));
var globalScope = (() => {
  if (typeof globalThis === "object") return globalThis;
  else {
    Object.defineProperty(Object.prototype, "__GLOBALTHIS__", {
      get() {
        return this;
      },
      configurable: true
    });
    try {
      if (typeof __GLOBALTHIS__ !== "undefined") return __GLOBALTHIS__;
    } finally {
      delete Object.prototype.__GLOBALTHIS__;
    }
  }
  if (typeof self !== "undefined") return self;
  else if (typeof window !== "undefined") return window;
  else if (typeof global !== "undefined") return global;
  return void 0;
})();
var nobleHashes = {
  SHA1: sha1,
  SHA224: sha224,
  SHA256: sha256,
  SHA384: sha384,
  SHA512: sha512,
  "SHA3-224": sha3_224,
  "SHA3-256": sha3_256,
  "SHA3-384": sha3_384,
  "SHA3-512": sha3_512
};
var canonicalizeAlgorithm = /* @__PURE__ */ __name((algorithm) => {
  switch (true) {
    case /^(?:SHA-?1|SSL3-SHA1)$/i.test(algorithm):
      return "SHA1";
    case /^SHA(?:2?-)?224$/i.test(algorithm):
      return "SHA224";
    case /^SHA(?:2?-)?256$/i.test(algorithm):
      return "SHA256";
    case /^SHA(?:2?-)?384$/i.test(algorithm):
      return "SHA384";
    case /^SHA(?:2?-)?512$/i.test(algorithm):
      return "SHA512";
    case /^SHA3-224$/i.test(algorithm):
      return "SHA3-224";
    case /^SHA3-256$/i.test(algorithm):
      return "SHA3-256";
    case /^SHA3-384$/i.test(algorithm):
      return "SHA3-384";
    case /^SHA3-512$/i.test(algorithm):
      return "SHA3-512";
    default:
      throw new TypeError(`Unknown hash algorithm: ${algorithm}`);
  }
}, "canonicalizeAlgorithm");
var hmacDigest = /* @__PURE__ */ __name((algorithm, key, message2) => {
  if (hmac) {
    const hash = nobleHashes[algorithm] ?? nobleHashes[canonicalizeAlgorithm(algorithm)];
    return hmac(hash, key, message2);
  } else {
    throw new Error("Missing HMAC function");
  }
}, "hmacDigest");
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
var base32Decode = /* @__PURE__ */ __name((str) => {
  str = str.replace(/ /g, "");
  let end = str.length;
  while (str[end - 1] === "=") --end;
  str = (end < str.length ? str.substring(0, end) : str).toUpperCase();
  const buf = new ArrayBuffer(str.length * 5 / 8 | 0);
  const arr = new Uint8Array(buf);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (let i2 = 0; i2 < str.length; i2++) {
    const idx = ALPHABET.indexOf(str[i2]);
    if (idx === -1) throw new TypeError(`Invalid character found: ${str[i2]}`);
    value = value << 5 | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      arr[index++] = value >>> bits;
    }
  }
  return arr;
}, "base32Decode");
var base32Encode = /* @__PURE__ */ __name((arr) => {
  let bits = 0;
  let value = 0;
  let str = "";
  for (let i2 = 0; i2 < arr.length; i2++) {
    value = value << 8 | arr[i2];
    bits += 8;
    while (bits >= 5) {
      str += ALPHABET[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    str += ALPHABET[value << 5 - bits & 31];
  }
  return str;
}, "base32Encode");
var hexDecode = /* @__PURE__ */ __name((str) => {
  str = str.replace(/ /g, "");
  const buf = new ArrayBuffer(str.length / 2);
  const arr = new Uint8Array(buf);
  for (let i2 = 0; i2 < str.length; i2 += 2) {
    arr[i2 / 2] = parseInt(str.substring(i2, i2 + 2), 16);
  }
  return arr;
}, "hexDecode");
var hexEncode = /* @__PURE__ */ __name((arr) => {
  let str = "";
  for (let i2 = 0; i2 < arr.length; i2++) {
    const hex = arr[i2].toString(16);
    if (hex.length === 1) str += "0";
    str += hex;
  }
  return str.toUpperCase();
}, "hexEncode");
var latin1Decode = /* @__PURE__ */ __name((str) => {
  const buf = new ArrayBuffer(str.length);
  const arr = new Uint8Array(buf);
  for (let i2 = 0; i2 < str.length; i2++) {
    arr[i2] = str.charCodeAt(i2) & 255;
  }
  return arr;
}, "latin1Decode");
var latin1Encode = /* @__PURE__ */ __name((arr) => {
  let str = "";
  for (let i2 = 0; i2 < arr.length; i2++) {
    str += String.fromCharCode(arr[i2]);
  }
  return str;
}, "latin1Encode");
var ENCODER = globalScope.TextEncoder ? new globalScope.TextEncoder() : null;
var DECODER = globalScope.TextDecoder ? new globalScope.TextDecoder() : null;
var utf8Decode = /* @__PURE__ */ __name((str) => {
  if (!ENCODER) {
    throw new Error("Encoding API not available");
  }
  return ENCODER.encode(str);
}, "utf8Decode");
var utf8Encode = /* @__PURE__ */ __name((arr) => {
  if (!DECODER) {
    throw new Error("Encoding API not available");
  }
  return DECODER.decode(arr);
}, "utf8Encode");
var randomBytes = /* @__PURE__ */ __name((size) => {
  if (globalScope.crypto?.getRandomValues) {
    return globalScope.crypto.getRandomValues(new Uint8Array(size));
  } else {
    throw new Error("Cryptography API not available");
  }
}, "randomBytes");
var Secret = class _Secret {
  static {
    __name(this, "Secret");
  }
  /**
  * Converts a Latin-1 string to a Secret object.
  * @param {string} str Latin-1 string.
  * @returns {Secret} Secret object.
  */
  static fromLatin1(str) {
    return new _Secret({
      buffer: latin1Decode(str).buffer
    });
  }
  /**
  * Converts an UTF-8 string to a Secret object.
  * @param {string} str UTF-8 string.
  * @returns {Secret} Secret object.
  */
  static fromUTF8(str) {
    return new _Secret({
      buffer: utf8Decode(str).buffer
    });
  }
  /**
  * Converts a base32 string to a Secret object.
  * @param {string} str Base32 string.
  * @returns {Secret} Secret object.
  */
  static fromBase32(str) {
    return new _Secret({
      buffer: base32Decode(str).buffer
    });
  }
  /**
  * Converts a hexadecimal string to a Secret object.
  * @param {string} str Hexadecimal string.
  * @returns {Secret} Secret object.
  */
  static fromHex(str) {
    return new _Secret({
      buffer: hexDecode(str).buffer
    });
  }
  /**
  * Secret key buffer.
  * @deprecated For backward compatibility, the "bytes" property should be used instead.
  * @type {ArrayBufferLike}
  */
  get buffer() {
    return this.bytes.buffer;
  }
  /**
  * Latin-1 string representation of secret key.
  * @type {string}
  */
  get latin1() {
    Object.defineProperty(this, "latin1", {
      enumerable: true,
      writable: false,
      configurable: false,
      value: latin1Encode(this.bytes)
    });
    return this.latin1;
  }
  /**
  * UTF-8 string representation of secret key.
  * @type {string}
  */
  get utf8() {
    Object.defineProperty(this, "utf8", {
      enumerable: true,
      writable: false,
      configurable: false,
      value: utf8Encode(this.bytes)
    });
    return this.utf8;
  }
  /**
  * Base32 string representation of secret key.
  * @type {string}
  */
  get base32() {
    Object.defineProperty(this, "base32", {
      enumerable: true,
      writable: false,
      configurable: false,
      value: base32Encode(this.bytes)
    });
    return this.base32;
  }
  /**
  * Hexadecimal string representation of secret key.
  * @type {string}
  */
  get hex() {
    Object.defineProperty(this, "hex", {
      enumerable: true,
      writable: false,
      configurable: false,
      value: hexEncode(this.bytes)
    });
    return this.hex;
  }
  /**
  * Creates a secret key object.
  * @param {Object} [config] Configuration options.
  * @param {ArrayBufferLike} [config.buffer] Secret key buffer.
  * @param {number} [config.size=20] Number of random bytes to generate, ignored if 'buffer' is provided.
  */
  constructor({ buffer, size = 20 } = {}) {
    this.bytes = typeof buffer === "undefined" ? randomBytes(size) : new Uint8Array(buffer);
    Object.defineProperty(this, "bytes", {
      enumerable: true,
      writable: false,
      configurable: false,
      value: this.bytes
    });
  }
};
var timingSafeEqual = /* @__PURE__ */ __name((a2, b) => {
  {
    if (a2.length !== b.length) {
      throw new TypeError("Input strings must have the same length");
    }
    let i2 = -1;
    let out = 0;
    while (++i2 < a2.length) {
      out |= a2.charCodeAt(i2) ^ b.charCodeAt(i2);
    }
    return out === 0;
  }
}, "timingSafeEqual");
var HOTP = class _HOTP {
  static {
    __name(this, "HOTP");
  }
  /**
  * Default configuration.
  * @type {{
  *   issuer: string,
  *   label: string,
  *   issuerInLabel: boolean,
  *   algorithm: string,
  *   digits: number,
  *   counter: number
  *   window: number
  * }}
  */
  static get defaults() {
    return {
      issuer: "",
      label: "OTPAuth",
      issuerInLabel: true,
      algorithm: "SHA1",
      digits: 6,
      counter: 0,
      window: 1
    };
  }
  /**
  * Generates an HOTP token.
  * @param {Object} config Configuration options.
  * @param {Secret} config.secret Secret key.
  * @param {string} [config.algorithm='SHA1'] HMAC hashing algorithm.
  * @param {number} [config.digits=6] Token length.
  * @param {number} [config.counter=0] Counter value.
  * @param {(algorithm: string, key: Uint8Array, message: Uint8Array) => Uint8Array} [config.hmac] Custom HMAC function.
  * @returns {string} Token.
  */
  static generate({ secret, algorithm = _HOTP.defaults.algorithm, digits = _HOTP.defaults.digits, counter = _HOTP.defaults.counter, hmac: hmac2 = hmacDigest }) {
    const message2 = uintDecode(counter);
    const digest = hmac2(algorithm, secret.bytes, message2);
    if (!digest?.byteLength || digest.byteLength < 19) {
      throw new TypeError("Return value must be at least 19 bytes");
    }
    const offset = digest[digest.byteLength - 1] & 15;
    const otp = ((digest[offset] & 127) << 24 | (digest[offset + 1] & 255) << 16 | (digest[offset + 2] & 255) << 8 | digest[offset + 3] & 255) % 10 ** digits;
    return otp.toString().padStart(digits, "0");
  }
  /**
  * Generates an HOTP token.
  * @param {Object} [config] Configuration options.
  * @param {number} [config.counter=this.counter++] Counter value.
  * @returns {string} Token.
  */
  generate({ counter = this.counter++ } = {}) {
    return _HOTP.generate({
      secret: this.secret,
      algorithm: this.algorithm,
      digits: this.digits,
      counter,
      hmac: this.hmac
    });
  }
  /**
  * Validates an HOTP token.
  * @param {Object} config Configuration options.
  * @param {string} config.token Token value.
  * @param {Secret} config.secret Secret key.
  * @param {string} [config.algorithm='SHA1'] HMAC hashing algorithm.
  * @param {number} [config.digits=6] Token length.
  * @param {number} [config.counter=0] Counter value.
  * @param {number} [config.window=1] Window of counter values to test.
  * @param {(algorithm: string, key: Uint8Array, message: Uint8Array) => Uint8Array} [config.hmac] Custom HMAC function.
  * @returns {number|null} Token delta or null if it is not found in the search window, in which case it should be considered invalid.
  */
  static validate({ token, secret, algorithm, digits = _HOTP.defaults.digits, counter = _HOTP.defaults.counter, window: window2 = _HOTP.defaults.window, hmac: hmac2 = hmacDigest }) {
    if (token.length !== digits) return null;
    let delta = null;
    const check = /* @__PURE__ */ __name((i2) => {
      const generatedToken = _HOTP.generate({
        secret,
        algorithm,
        digits,
        counter: i2,
        hmac: hmac2
      });
      if (timingSafeEqual(token, generatedToken)) {
        delta = i2 - counter;
      }
    }, "check");
    check(counter);
    for (let i2 = 1; i2 <= window2 && delta === null; ++i2) {
      check(counter - i2);
      if (delta !== null) break;
      check(counter + i2);
      if (delta !== null) break;
    }
    return delta;
  }
  /**
  * Validates an HOTP token.
  * @param {Object} config Configuration options.
  * @param {string} config.token Token value.
  * @param {number} [config.counter=this.counter] Counter value.
  * @param {number} [config.window=1] Window of counter values to test.
  * @returns {number|null} Token delta or null if it is not found in the search window, in which case it should be considered invalid.
  */
  validate({ token, counter = this.counter, window: window2 }) {
    return _HOTP.validate({
      token,
      secret: this.secret,
      algorithm: this.algorithm,
      digits: this.digits,
      counter,
      window: window2,
      hmac: this.hmac
    });
  }
  /**
  * Returns a Google Authenticator key URI.
  * @returns {string} URI.
  */
  toString() {
    const e = encodeURIComponent;
    return `otpauth://hotp/${this.issuer.length > 0 ? this.issuerInLabel ? `${e(this.issuer)}:${e(this.label)}?issuer=${e(this.issuer)}&` : `${e(this.label)}?issuer=${e(this.issuer)}&` : `${e(this.label)}?`}secret=${e(this.secret.base32)}&algorithm=${e(this.algorithm)}&digits=${e(this.digits)}&counter=${e(this.counter)}`;
  }
  /**
  * Creates an HOTP object.
  * @param {Object} [config] Configuration options.
  * @param {string} [config.issuer=''] Account provider.
  * @param {string} [config.label='OTPAuth'] Account label.
  * @param {boolean} [config.issuerInLabel=true] Include issuer prefix in label.
  * @param {Secret|string} [config.secret=Secret] Secret key.
  * @param {string} [config.algorithm='SHA1'] HMAC hashing algorithm.
  * @param {number} [config.digits=6] Token length.
  * @param {number} [config.counter=0] Initial counter value.
  * @param {(algorithm: string, key: Uint8Array, message: Uint8Array) => Uint8Array} [config.hmac] Custom HMAC function.
  */
  constructor({ issuer = _HOTP.defaults.issuer, label = _HOTP.defaults.label, issuerInLabel = _HOTP.defaults.issuerInLabel, secret = new Secret(), algorithm = _HOTP.defaults.algorithm, digits = _HOTP.defaults.digits, counter = _HOTP.defaults.counter, hmac: hmac2 } = {}) {
    this.issuer = issuer;
    this.label = label;
    this.issuerInLabel = issuerInLabel;
    this.secret = typeof secret === "string" ? Secret.fromBase32(secret) : secret;
    this.algorithm = hmac2 ? algorithm : canonicalizeAlgorithm(algorithm);
    this.digits = digits;
    this.counter = counter;
    this.hmac = hmac2;
  }
};
var TOTP = class _TOTP {
  static {
    __name(this, "TOTP");
  }
  /**
  * Default configuration.
  * @type {{
  *   issuer: string,
  *   label: string,
  *   issuerInLabel: boolean,
  *   algorithm: string,
  *   digits: number,
  *   period: number
  *   window: number
  * }}
  */
  static get defaults() {
    return {
      issuer: "",
      label: "OTPAuth",
      issuerInLabel: true,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      window: 1
    };
  }
  /**
  * Calculates the counter. i.e. the number of periods since timestamp 0.
  * @param {Object} [config] Configuration options.
  * @param {number} [config.period=30] Token time-step duration.
  * @param {number} [config.timestamp=Date.now] Timestamp value in milliseconds.
  * @returns {number} Counter.
  */
  static counter({ period = _TOTP.defaults.period, timestamp = Date.now() } = {}) {
    return Math.floor(timestamp / 1e3 / period);
  }
  /**
  * Calculates the counter. i.e. the number of periods since timestamp 0.
  * @param {Object} [config] Configuration options.
  * @param {number} [config.timestamp=Date.now] Timestamp value in milliseconds.
  * @returns {number} Counter.
  */
  counter({ timestamp = Date.now() } = {}) {
    return _TOTP.counter({
      period: this.period,
      timestamp
    });
  }
  /**
  * Calculates the remaining time in milliseconds until the next token is generated.
  * @param {Object} [config] Configuration options.
  * @param {number} [config.period=30] Token time-step duration.
  * @param {number} [config.timestamp=Date.now] Timestamp value in milliseconds.
  * @returns {number} counter.
  */
  static remaining({ period = _TOTP.defaults.period, timestamp = Date.now() } = {}) {
    return period * 1e3 - timestamp % (period * 1e3);
  }
  /**
  * Calculates the remaining time in milliseconds until the next token is generated.
  * @param {Object} [config] Configuration options.
  * @param {number} [config.timestamp=Date.now] Timestamp value in milliseconds.
  * @returns {number} counter.
  */
  remaining({ timestamp = Date.now() } = {}) {
    return _TOTP.remaining({
      period: this.period,
      timestamp
    });
  }
  /**
  * Generates a TOTP token.
  * @param {Object} config Configuration options.
  * @param {Secret} config.secret Secret key.
  * @param {string} [config.algorithm='SHA1'] HMAC hashing algorithm.
  * @param {number} [config.digits=6] Token length.
  * @param {number} [config.period=30] Token time-step duration.
  * @param {number} [config.timestamp=Date.now] Timestamp value in milliseconds.
  * @param {(algorithm: string, key: Uint8Array, message: Uint8Array) => Uint8Array} [config.hmac] Custom HMAC function.
  * @returns {string} Token.
  */
  static generate({ secret, algorithm, digits, period = _TOTP.defaults.period, timestamp = Date.now(), hmac: hmac2 }) {
    return HOTP.generate({
      secret,
      algorithm,
      digits,
      counter: _TOTP.counter({
        period,
        timestamp
      }),
      hmac: hmac2
    });
  }
  /**
  * Generates a TOTP token.
  * @param {Object} [config] Configuration options.
  * @param {number} [config.timestamp=Date.now] Timestamp value in milliseconds.
  * @returns {string} Token.
  */
  generate({ timestamp = Date.now() } = {}) {
    return _TOTP.generate({
      secret: this.secret,
      algorithm: this.algorithm,
      digits: this.digits,
      period: this.period,
      timestamp,
      hmac: this.hmac
    });
  }
  /**
  * Validates a TOTP token.
  * @param {Object} config Configuration options.
  * @param {string} config.token Token value.
  * @param {Secret} config.secret Secret key.
  * @param {string} [config.algorithm='SHA1'] HMAC hashing algorithm.
  * @param {number} [config.digits=6] Token length.
  * @param {number} [config.period=30] Token time-step duration.
  * @param {number} [config.timestamp=Date.now] Timestamp value in milliseconds.
  * @param {number} [config.window=1] Window of counter values to test.
  * @param {(algorithm: string, key: Uint8Array, message: Uint8Array) => Uint8Array} [config.hmac] Custom HMAC function.
  * @returns {number|null} Token delta or null if it is not found in the search window, in which case it should be considered invalid.
  */
  static validate({ token, secret, algorithm, digits, period = _TOTP.defaults.period, timestamp = Date.now(), window: window2, hmac: hmac2 }) {
    return HOTP.validate({
      token,
      secret,
      algorithm,
      digits,
      counter: _TOTP.counter({
        period,
        timestamp
      }),
      window: window2,
      hmac: hmac2
    });
  }
  /**
  * Validates a TOTP token.
  * @param {Object} config Configuration options.
  * @param {string} config.token Token value.
  * @param {number} [config.timestamp=Date.now] Timestamp value in milliseconds.
  * @param {number} [config.window=1] Window of counter values to test.
  * @returns {number|null} Token delta or null if it is not found in the search window, in which case it should be considered invalid.
  */
  validate({ token, timestamp, window: window2 }) {
    return _TOTP.validate({
      token,
      secret: this.secret,
      algorithm: this.algorithm,
      digits: this.digits,
      period: this.period,
      timestamp,
      window: window2,
      hmac: this.hmac
    });
  }
  /**
  * Returns a Google Authenticator key URI.
  * @returns {string} URI.
  */
  toString() {
    const e = encodeURIComponent;
    return `otpauth://totp/${this.issuer.length > 0 ? this.issuerInLabel ? `${e(this.issuer)}:${e(this.label)}?issuer=${e(this.issuer)}&` : `${e(this.label)}?issuer=${e(this.issuer)}&` : `${e(this.label)}?`}secret=${e(this.secret.base32)}&algorithm=${e(this.algorithm)}&digits=${e(this.digits)}&period=${e(this.period)}`;
  }
  /**
  * Creates a TOTP object.
  * @param {Object} [config] Configuration options.
  * @param {string} [config.issuer=''] Account provider.
  * @param {string} [config.label='OTPAuth'] Account label.
  * @param {boolean} [config.issuerInLabel=true] Include issuer prefix in label.
  * @param {Secret|string} [config.secret=Secret] Secret key.
  * @param {string} [config.algorithm='SHA1'] HMAC hashing algorithm.
  * @param {number} [config.digits=6] Token length.
  * @param {number} [config.period=30] Token time-step duration.
  * @param {(algorithm: string, key: Uint8Array, message: Uint8Array) => Uint8Array} [config.hmac] Custom HMAC function.
  */
  constructor({ issuer = _TOTP.defaults.issuer, label = _TOTP.defaults.label, issuerInLabel = _TOTP.defaults.issuerInLabel, secret = new Secret(), algorithm = _TOTP.defaults.algorithm, digits = _TOTP.defaults.digits, period = _TOTP.defaults.period, hmac: hmac2 } = {}) {
    this.issuer = issuer;
    this.label = label;
    this.issuerInLabel = issuerInLabel;
    this.secret = typeof secret === "string" ? Secret.fromBase32(secret) : secret;
    this.algorithm = hmac2 ? algorithm : canonicalizeAlgorithm(algorithm);
    this.digits = digits;
    this.period = period;
    this.hmac = hmac2;
  }
};

// src/routes/auth.ts
var QRCode = __toESM(require_browser(), 1);

// src/services/email.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
import { EmailMessage } from "cloudflare:email";

// node_modules/mimetext/dist/mimetext.browser.es.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/js-base64/base64.mjs
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var version2 = "3.7.8";
var VERSION = version2;
var _hasBuffer = typeof Buffer === "function";
var _TD = typeof TextDecoder === "function" ? new TextDecoder() : void 0;
var _TE = typeof TextEncoder === "function" ? new TextEncoder() : void 0;
var b64ch = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
var b64chs = Array.prototype.slice.call(b64ch);
var b64tab = ((a2) => {
  let tab = {};
  a2.forEach((c2, i2) => tab[c2] = i2);
  return tab;
})(b64chs);
var b64re = /^(?:[A-Za-z\d+\/]{4})*?(?:[A-Za-z\d+\/]{2}(?:==)?|[A-Za-z\d+\/]{3}=?)?$/;
var _fromCC = String.fromCharCode.bind(String);
var _U8Afrom = typeof Uint8Array.from === "function" ? Uint8Array.from.bind(Uint8Array) : (it) => new Uint8Array(Array.prototype.slice.call(it, 0));
var _mkUriSafe = /* @__PURE__ */ __name((src) => src.replace(/=/g, "").replace(/[+\/]/g, (m0) => m0 == "+" ? "-" : "_"), "_mkUriSafe");
var _tidyB64 = /* @__PURE__ */ __name((s2) => s2.replace(/[^A-Za-z0-9\+\/]/g, ""), "_tidyB64");
var btoaPolyfill = /* @__PURE__ */ __name((bin) => {
  let u322, c0, c1, c2, asc = "";
  const pad = bin.length % 3;
  for (let i2 = 0; i2 < bin.length; ) {
    if ((c0 = bin.charCodeAt(i2++)) > 255 || (c1 = bin.charCodeAt(i2++)) > 255 || (c2 = bin.charCodeAt(i2++)) > 255)
      throw new TypeError("invalid character found");
    u322 = c0 << 16 | c1 << 8 | c2;
    asc += b64chs[u322 >> 18 & 63] + b64chs[u322 >> 12 & 63] + b64chs[u322 >> 6 & 63] + b64chs[u322 & 63];
  }
  return pad ? asc.slice(0, pad - 3) + "===".substring(pad) : asc;
}, "btoaPolyfill");
var _btoa = typeof btoa === "function" ? (bin) => btoa(bin) : _hasBuffer ? (bin) => Buffer.from(bin, "binary").toString("base64") : btoaPolyfill;
var _fromUint8Array = _hasBuffer ? (u8a) => Buffer.from(u8a).toString("base64") : (u8a) => {
  const maxargs = 4096;
  let strs = [];
  for (let i2 = 0, l = u8a.length; i2 < l; i2 += maxargs) {
    strs.push(_fromCC.apply(null, u8a.subarray(i2, i2 + maxargs)));
  }
  return _btoa(strs.join(""));
};
var fromUint8Array = /* @__PURE__ */ __name((u8a, urlsafe = false) => urlsafe ? _mkUriSafe(_fromUint8Array(u8a)) : _fromUint8Array(u8a), "fromUint8Array");
var cb_utob = /* @__PURE__ */ __name((c2) => {
  if (c2.length < 2) {
    var cc = c2.charCodeAt(0);
    return cc < 128 ? c2 : cc < 2048 ? _fromCC(192 | cc >>> 6) + _fromCC(128 | cc & 63) : _fromCC(224 | cc >>> 12 & 15) + _fromCC(128 | cc >>> 6 & 63) + _fromCC(128 | cc & 63);
  } else {
    var cc = 65536 + (c2.charCodeAt(0) - 55296) * 1024 + (c2.charCodeAt(1) - 56320);
    return _fromCC(240 | cc >>> 18 & 7) + _fromCC(128 | cc >>> 12 & 63) + _fromCC(128 | cc >>> 6 & 63) + _fromCC(128 | cc & 63);
  }
}, "cb_utob");
var re_utob = /[\uD800-\uDBFF][\uDC00-\uDFFFF]|[^\x00-\x7F]/g;
var utob = /* @__PURE__ */ __name((u) => u.replace(re_utob, cb_utob), "utob");
var _encode = _hasBuffer ? (s2) => Buffer.from(s2, "utf8").toString("base64") : _TE ? (s2) => _fromUint8Array(_TE.encode(s2)) : (s2) => _btoa(utob(s2));
var encode2 = /* @__PURE__ */ __name((src, urlsafe = false) => urlsafe ? _mkUriSafe(_encode(src)) : _encode(src), "encode");
var encodeURI2 = /* @__PURE__ */ __name((src) => encode2(src, true), "encodeURI");
var re_btou = /[\xC0-\xDF][\x80-\xBF]|[\xE0-\xEF][\x80-\xBF]{2}|[\xF0-\xF7][\x80-\xBF]{3}/g;
var cb_btou = /* @__PURE__ */ __name((cccc) => {
  switch (cccc.length) {
    case 4:
      var cp = (7 & cccc.charCodeAt(0)) << 18 | (63 & cccc.charCodeAt(1)) << 12 | (63 & cccc.charCodeAt(2)) << 6 | 63 & cccc.charCodeAt(3), offset = cp - 65536;
      return _fromCC((offset >>> 10) + 55296) + _fromCC((offset & 1023) + 56320);
    case 3:
      return _fromCC((15 & cccc.charCodeAt(0)) << 12 | (63 & cccc.charCodeAt(1)) << 6 | 63 & cccc.charCodeAt(2));
    default:
      return _fromCC((31 & cccc.charCodeAt(0)) << 6 | 63 & cccc.charCodeAt(1));
  }
}, "cb_btou");
var btou = /* @__PURE__ */ __name((b) => b.replace(re_btou, cb_btou), "btou");
var atobPolyfill = /* @__PURE__ */ __name((asc) => {
  asc = asc.replace(/\s+/g, "");
  if (!b64re.test(asc))
    throw new TypeError("malformed base64.");
  asc += "==".slice(2 - (asc.length & 3));
  let u24, r1, r22;
  let binArray = [];
  for (let i2 = 0; i2 < asc.length; ) {
    u24 = b64tab[asc.charAt(i2++)] << 18 | b64tab[asc.charAt(i2++)] << 12 | (r1 = b64tab[asc.charAt(i2++)]) << 6 | (r22 = b64tab[asc.charAt(i2++)]);
    if (r1 === 64) {
      binArray.push(_fromCC(u24 >> 16 & 255));
    } else if (r22 === 64) {
      binArray.push(_fromCC(u24 >> 16 & 255, u24 >> 8 & 255));
    } else {
      binArray.push(_fromCC(u24 >> 16 & 255, u24 >> 8 & 255, u24 & 255));
    }
  }
  return binArray.join("");
}, "atobPolyfill");
var _atob = typeof atob === "function" ? (asc) => atob(_tidyB64(asc)) : _hasBuffer ? (asc) => Buffer.from(asc, "base64").toString("binary") : atobPolyfill;
var _toUint8Array = _hasBuffer ? (a2) => _U8Afrom(Buffer.from(a2, "base64")) : (a2) => _U8Afrom(_atob(a2).split("").map((c2) => c2.charCodeAt(0)));
var toUint8Array = /* @__PURE__ */ __name((a2) => _toUint8Array(_unURI(a2)), "toUint8Array");
var _decode = _hasBuffer ? (a2) => Buffer.from(a2, "base64").toString("utf8") : _TD ? (a2) => _TD.decode(_toUint8Array(a2)) : (a2) => btou(_atob(a2));
var _unURI = /* @__PURE__ */ __name((a2) => _tidyB64(a2.replace(/[-_]/g, (m0) => m0 == "-" ? "+" : "/")), "_unURI");
var decode2 = /* @__PURE__ */ __name((src) => _decode(_unURI(src)), "decode");
var isValid = /* @__PURE__ */ __name((src) => {
  if (typeof src !== "string")
    return false;
  const s2 = src.replace(/\s+/g, "").replace(/={0,2}$/, "");
  return !/[^\s0-9a-zA-Z\+/]/.test(s2) || !/[^\s0-9a-zA-Z\-_]/.test(s2);
}, "isValid");
var _noEnum = /* @__PURE__ */ __name((v) => {
  return {
    value: v,
    enumerable: false,
    writable: true,
    configurable: true
  };
}, "_noEnum");
var extendString = /* @__PURE__ */ __name(function() {
  const _add = /* @__PURE__ */ __name((name, body) => Object.defineProperty(String.prototype, name, _noEnum(body)), "_add");
  _add("fromBase64", function() {
    return decode2(this);
  });
  _add("toBase64", function(urlsafe) {
    return encode2(this, urlsafe);
  });
  _add("toBase64URI", function() {
    return encode2(this, true);
  });
  _add("toBase64URL", function() {
    return encode2(this, true);
  });
  _add("toUint8Array", function() {
    return toUint8Array(this);
  });
}, "extendString");
var extendUint8Array = /* @__PURE__ */ __name(function() {
  const _add = /* @__PURE__ */ __name((name, body) => Object.defineProperty(Uint8Array.prototype, name, _noEnum(body)), "_add");
  _add("toBase64", function(urlsafe) {
    return fromUint8Array(this, urlsafe);
  });
  _add("toBase64URI", function() {
    return fromUint8Array(this, true);
  });
  _add("toBase64URL", function() {
    return fromUint8Array(this, true);
  });
}, "extendUint8Array");
var extendBuiltins = /* @__PURE__ */ __name(() => {
  extendString();
  extendUint8Array();
}, "extendBuiltins");
var gBase64 = {
  version: version2,
  VERSION,
  atob: _atob,
  atobPolyfill,
  btoa: _btoa,
  btoaPolyfill,
  fromBase64: decode2,
  toBase64: encode2,
  encode: encode2,
  encodeURI: encodeURI2,
  encodeURL: encodeURI2,
  utob,
  btou,
  decode: decode2,
  isValid,
  fromUint8Array,
  toUint8Array,
  extendString,
  extendUint8Array,
  extendBuiltins
};

// node_modules/@babel/runtime-corejs3/helpers/esm/defineProperty.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var import_define_property = __toESM(require_define_property5(), 1);

// node_modules/@babel/runtime-corejs3/helpers/esm/toPropertyKey.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/@babel/runtime-corejs3/helpers/esm/typeof.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var import_symbol = __toESM(require_symbol5(), 1);
var import_iterator = __toESM(require_iterator5(), 1);
function _typeof(o2) {
  "@babel/helpers - typeof";
  return _typeof = "function" == typeof import_symbol.default && "symbol" == typeof import_iterator.default ? function(o3) {
    return typeof o3;
  } : function(o3) {
    return o3 && "function" == typeof import_symbol.default && o3.constructor === import_symbol.default && o3 !== import_symbol.default.prototype ? "symbol" : typeof o3;
  }, _typeof(o2);
}
__name(_typeof, "_typeof");

// node_modules/@babel/runtime-corejs3/helpers/esm/toPrimitive.js
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var import_to_primitive = __toESM(require_to_primitive6(), 1);
function toPrimitive(t, r3) {
  if ("object" != _typeof(t) || !t) return t;
  var e = t[import_to_primitive.default];
  if (void 0 !== e) {
    var i2 = e.call(t, r3 || "default");
    if ("object" != _typeof(i2)) return i2;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return ("string" === r3 ? String : Number)(t);
}
__name(toPrimitive, "toPrimitive");

// node_modules/@babel/runtime-corejs3/helpers/esm/toPropertyKey.js
function toPropertyKey(t) {
  var i2 = toPrimitive(t, "string");
  return "symbol" == _typeof(i2) ? i2 : i2 + "";
}
__name(toPropertyKey, "toPropertyKey");

// node_modules/@babel/runtime-corejs3/helpers/esm/defineProperty.js
function _defineProperty(e, r3, t) {
  return (r3 = toPropertyKey(r3)) in e ? (0, import_define_property.default)(e, r3, {
    value: t,
    enumerable: true,
    configurable: true,
    writable: true
  }) : e[r3] = t, e;
}
__name(_defineProperty, "_defineProperty");

// node_modules/mimetext/dist/mimetext.browser.es.js
var import_trim = __toESM(require_trim7(), 1);
var n = class extends Error {
  static {
    __name(this, "n");
  }
  constructor(e) {
    let s2 = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : "";
    super(s2), _defineProperty(this, "name", ""), _defineProperty(this, "description", ""), this.name = e, this.description = s2;
  }
};
var i = class {
  static {
    __name(this, "i");
  }
  constructor(e) {
    let s2 = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : { type: "To" };
    _defineProperty(this, "reSpecCompliantAddr", /(([^<>\r\n]+)\s)?<[^\r\n]+>/), _defineProperty(this, "name", ""), _defineProperty(this, "addr", ""), _defineProperty(this, "type", "To"), this.type = s2.type, this.parse(e);
  }
  getAddrDomain() {
    if (this.addr.includes("@")) {
      const e = this.addr.split("@");
      if (e.length > 1) return e[1];
    }
    return "";
  }
  dump() {
    return this.name.length > 0 ? '"'.concat(this.name, '" <').concat(this.addr, ">") : "<".concat(this.addr, ">");
  }
  parse(e) {
    if (this.isMailboxAddrObject(e)) return this.addr = e.addr, "string" == typeof e.name && (this.name = e.name), "string" == typeof e.type && (this.type = e.type), this;
    if (this.isMailboxAddrText(e)) {
      const t = (0, import_trim.default)(e).call(e);
      if (t.startsWith("<") && t.endsWith(">")) return this.addr = t.slice(1, -1), this;
      const n2 = t.split(" <");
      return n2[0] = /^("|')/.test(n2[0]) ? n2[0].slice(1) : n2[0], n2[0] = /("|')$/.test(n2[0]) ? n2[0].slice(0, -1) : n2[0], n2[1] = n2[1].slice(0, -1), this.name = n2[0], this.addr = n2[1], this;
    }
    if ("string" == typeof e) return this.addr = e, this;
    throw new n("MIMETEXT_INVALID_MAILBOX", "Couldn't recognize the input.");
  }
  isMailboxAddrText(e) {
    return "string" == typeof e && this.reSpecCompliantAddr.test(e);
  }
  isMailboxAddrObject(e) {
    return this.isObject(e) && Object.hasOwn(e, "addr");
  }
  isObject(e) {
    return !!e && e.constructor === Object;
  }
};
var a = class {
  static {
    __name(this, "a");
  }
  constructor(e) {
    _defineProperty(this, "envctx", void 0), _defineProperty(this, "fields", [{ name: "Date", generator: /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toUTCString().replace(/GMT|UTC/gi, "+0000"), "generator") }, { name: "From", required: true, validate: /* @__PURE__ */ __name((e2) => this.validateMailboxSingle(e2), "validate"), dump: /* @__PURE__ */ __name((e2) => this.dumpMailboxSingle(e2), "dump") }, { name: "Sender", validate: /* @__PURE__ */ __name((e2) => this.validateMailboxSingle(e2), "validate"), dump: /* @__PURE__ */ __name((e2) => this.dumpMailboxSingle(e2), "dump") }, { name: "Reply-To", validate: /* @__PURE__ */ __name((e2) => this.validateMailboxSingle(e2), "validate"), dump: /* @__PURE__ */ __name((e2) => this.dumpMailboxSingle(e2), "dump") }, { name: "To", validate: /* @__PURE__ */ __name((e2) => this.validateMailboxMulti(e2), "validate"), dump: /* @__PURE__ */ __name((e2) => this.dumpMailboxMulti(e2), "dump") }, { name: "Cc", validate: /* @__PURE__ */ __name((e2) => this.validateMailboxMulti(e2), "validate"), dump: /* @__PURE__ */ __name((e2) => this.dumpMailboxMulti(e2), "dump") }, { name: "Bcc", validate: /* @__PURE__ */ __name((e2) => this.validateMailboxMulti(e2), "validate"), dump: /* @__PURE__ */ __name((e2) => this.dumpMailboxMulti(e2), "dump") }, { name: "Message-ID", generator: /* @__PURE__ */ __name(() => "<" + Math.random().toString(36).slice(2) + "@" + this.fields.filter(((e2) => "From" === e2.name))[0].value.getAddrDomain() + ">", "generator") }, { name: "Subject", required: true, dump: /* @__PURE__ */ __name((e2) => "string" == typeof e2 ? "=?utf-8?B?" + this.envctx.toBase64(e2) + "?=" : "", "dump") }, { name: "MIME-Version", generator: /* @__PURE__ */ __name(() => "1.0", "generator") }]), this.envctx = e;
  }
  dump() {
    let e = "";
    for (const t of this.fields) {
      if (t.disabled) continue;
      const s2 = void 0 !== t.value && null !== t.value;
      if (!s2 && t.required) throw new n("MIMETEXT_MISSING_HEADER", 'The "'.concat(t.name, '" header is required.'));
      if (!s2 && "function" != typeof t.generator) continue;
      s2 || "function" != typeof t.generator || (t.value = t.generator());
      const i2 = Object.hasOwn(t, "dump") && "function" == typeof t.dump ? t.dump(t.value) : "string" == typeof t.value ? t.value : "";
      e += "".concat(t.name, ": ").concat(i2).concat(this.envctx.eol);
    }
    return e.slice(0, -1 * this.envctx.eol.length);
  }
  toObject() {
    return this.fields.reduce(((e, t) => (e[t.name] = t.value, e)), {});
  }
  get(e) {
    const t = this.fields.findIndex(((t2) => t2.name.toLowerCase() === e.toLowerCase()));
    return -1 !== t ? this.fields[t].value : void 0;
  }
  set(e, t) {
    const s2 = /* @__PURE__ */ __name((t2) => t2.name.toLowerCase() === e.toLowerCase(), "s");
    if (!!this.fields.some(s2)) {
      const i2 = this.fields.findIndex(s2), a2 = this.fields[i2];
      if (a2.validate && !a2.validate(t)) throw new n("MIMETEXT_INVALID_HEADER_VALUE", 'The value for the header "'.concat(e, '" is invalid.'));
      return this.fields[i2].value = t, this.fields[i2];
    }
    return this.setCustom({ name: e, value: t, custom: true, dump: /* @__PURE__ */ __name((e2) => "string" == typeof e2 ? e2 : "", "dump") });
  }
  setCustom(e) {
    if (this.isHeaderField(e)) {
      if ("string" != typeof e.value) throw new n("MIMETEXT_INVALID_HEADER_FIELD", "Custom header must have a value.");
      return this.fields.push(e), e;
    }
    throw new n("MIMETEXT_INVALID_HEADER_FIELD", "Invalid input for custom header. It must be in type of HeaderField.");
  }
  validateMailboxSingle(e) {
    return e instanceof i;
  }
  validateMailboxMulti(e) {
    return e instanceof i || this.isArrayOfMailboxes(e);
  }
  dumpMailboxMulti(e) {
    const t = /* @__PURE__ */ __name((e2) => 0 === e2.name.length ? e2.dump() : "=?utf-8?B?".concat(this.envctx.toBase64(e2.name), "?= <").concat(e2.addr, ">"), "t");
    return this.isArrayOfMailboxes(e) ? e.map(t).join(",".concat(this.envctx.eol, " ")) : e instanceof i ? t(e) : "";
  }
  dumpMailboxSingle(e) {
    return e instanceof i ? ((e2) => 0 === e2.name.length ? e2.dump() : "=?utf-8?B?".concat(this.envctx.toBase64(e2.name), "?= <").concat(e2.addr, ">"))(e) : "";
  }
  isHeaderField(e) {
    const t = ["name", "value", "dump", "required", "disabled", "generator", "custom"];
    if (this.isObject(e)) {
      const s2 = e;
      if (Object.hasOwn(s2, "name") && "string" == typeof s2.name && s2.name.length > 0 && !Object.keys(s2).some(((e2) => !t.includes(e2)))) return true;
    }
    return false;
  }
  isObject(e) {
    return !!e && e.constructor === Object;
  }
  isArrayOfMailboxes(e) {
    return this.isArray(e) && e.every(((e2) => e2 instanceof i));
  }
  isArray(e) {
    return !!e && e.constructor === Array;
  }
};
var r = class extends a {
  static {
    __name(this, "r");
  }
  constructor(e) {
    super(e), _defineProperty(this, "fields", [{ name: "Content-ID" }, { name: "Content-Type" }, { name: "Content-Transfer-Encoding" }, { name: "Content-Disposition" }]);
  }
};
var o = class {
  static {
    __name(this, "o");
  }
  constructor(e, s2) {
    let n2 = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : {};
    _defineProperty(this, "envctx", void 0), _defineProperty(this, "headers", void 0), _defineProperty(this, "data", void 0), this.envctx = e, this.headers = new r(this.envctx), this.data = s2, this.setHeaders(n2);
  }
  dump() {
    const e = this.envctx.eol;
    return this.headers.dump() + e + e + this.data;
  }
  isAttachment() {
    const e = this.headers.get("Content-Disposition");
    return "string" == typeof e && e.includes("attachment");
  }
  isInlineAttachment() {
    const e = this.headers.get("Content-Disposition");
    return "string" == typeof e && e.includes("inline");
  }
  setHeader(e, t) {
    return this.headers.set(e, t), e;
  }
  getHeader(e) {
    return this.headers.get(e);
  }
  setHeaders(e) {
    return Object.keys(e).map(((t) => this.setHeader(t, e[t])));
  }
  getHeaders() {
    return this.headers.toObject();
  }
};
var d = class {
  static {
    __name(this, "d");
  }
  constructor(e) {
    _defineProperty(this, "envctx", void 0), _defineProperty(this, "headers", void 0), _defineProperty(this, "boundaries", { mixed: "", alt: "", related: "" }), _defineProperty(this, "validTypes", ["text/html", "text/plain"]), _defineProperty(this, "validContentTransferEncodings", ["7bit", "8bit", "binary", "quoted-printable", "base64"]), _defineProperty(this, "messages", []), this.envctx = e, this.headers = new a(this.envctx), this.messages = [], this.generateBoundaries();
  }
  asRaw() {
    const e = this.envctx.eol, t = this.headers.dump(), s2 = this.getMessageByType("text/plain"), i2 = this.getMessageByType("text/html"), a2 = null != i2 ? i2 : null != s2 ? s2 : void 0;
    if (void 0 === a2) throw new n("MIMETEXT_MISSING_BODY", "No content added to the message.");
    const r3 = this.hasAttachments(), o2 = this.hasInlineAttachments(), d2 = o2 && r3 ? "mixed+related" : r3 ? "mixed" : o2 ? "related" : s2 && i2 ? "alternative" : "";
    if ("mixed+related" === d2) {
      const n2 = this.getAttachments().map(((t2) => "--" + this.boundaries.mixed + e + t2.dump() + e + e)).join("").slice(0, -1 * e.length), a3 = this.getInlineAttachments().map(((t2) => "--" + this.boundaries.related + e + t2.dump() + e + e)).join("").slice(0, -1 * e.length);
      return t + e + "Content-Type: multipart/mixed; boundary=" + this.boundaries.mixed + e + e + "--" + this.boundaries.mixed + e + "Content-Type: multipart/related; boundary=" + this.boundaries.related + e + e + this.dumpTextContent(s2, i2, this.boundaries.related) + e + e + a3 + "--" + this.boundaries.related + "--" + e + n2 + "--" + this.boundaries.mixed + "--";
    }
    if ("mixed" === d2) {
      const n2 = this.getAttachments().map(((t2) => "--" + this.boundaries.mixed + e + t2.dump() + e + e)).join("").slice(0, -1 * e.length);
      return t + e + "Content-Type: multipart/mixed; boundary=" + this.boundaries.mixed + e + e + this.dumpTextContent(s2, i2, this.boundaries.mixed) + e + (s2 && i2 ? "" : e) + n2 + "--" + this.boundaries.mixed + "--";
    }
    if ("related" === d2) {
      const n2 = this.getInlineAttachments().map(((t2) => "--" + this.boundaries.related + e + t2.dump() + e + e)).join("").slice(0, -1 * e.length);
      return t + e + "Content-Type: multipart/related; boundary=" + this.boundaries.related + e + e + this.dumpTextContent(s2, i2, this.boundaries.related) + e + e + n2 + "--" + this.boundaries.related + "--";
    }
    return "alternative" === d2 ? t + e + "Content-Type: multipart/alternative; boundary=" + this.boundaries.alt + e + e + this.dumpTextContent(s2, i2, this.boundaries.alt) + e + e + "--" + this.boundaries.alt + "--" : t + e + a2.dump();
  }
  asEncoded() {
    return this.envctx.toBase64WebSafe(this.asRaw());
  }
  dumpTextContent(e, t, s2) {
    const n2 = this.envctx.eol, i2 = null != t ? t : e;
    let a2 = "";
    return a2 = e && t && (this.hasInlineAttachments() || this.hasAttachments()) ? "--" + s2 + n2 + "Content-Type: multipart/alternative; boundary=" + this.boundaries.alt + n2 + n2 + "--" + this.boundaries.alt + n2 + e.dump() + n2 + n2 + "--" + this.boundaries.alt + n2 + t.dump() + n2 + n2 + "--" + this.boundaries.alt + "--" : e && t ? "--" + s2 + n2 + e.dump() + n2 + n2 + "--" + s2 + n2 + t.dump() : "--" + s2 + n2 + i2.dump(), a2;
  }
  hasInlineAttachments() {
    return this.messages.some(((e) => e.isInlineAttachment()));
  }
  hasAttachments() {
    return this.messages.some(((e) => e.isAttachment()));
  }
  getAttachments() {
    const e = /* @__PURE__ */ __name((e2) => e2.isAttachment(), "e");
    return this.messages.some(e) ? this.messages.filter(e) : [];
  }
  getInlineAttachments() {
    const e = /* @__PURE__ */ __name((e2) => e2.isInlineAttachment(), "e");
    return this.messages.some(e) ? this.messages.filter(e) : [];
  }
  getMessageByType(e) {
    const t = /* @__PURE__ */ __name((t2) => !t2.isAttachment() && !t2.isInlineAttachment() && (t2.getHeader("Content-Type") || "").includes(e), "t");
    return this.messages.some(t) ? this.messages.filter(t)[0] : void 0;
  }
  addAttachment(e) {
    var t, s2, i2;
    if (this.isObject(e.headers) || (e.headers = {}), "string" != typeof e.filename) throw new n("MIMETEXT_MISSING_FILENAME", 'The property "filename" must exist while adding attachments.');
    let a2 = (null !== (t = e.headers["Content-Type"]) && void 0 !== t ? t : e.contentType) || "none";
    if (false === this.envctx.validateContentType(a2)) throw new n("MIMETEXT_INVALID_MESSAGE_TYPE", 'You specified an invalid content type "'.concat(a2, '".'));
    const r3 = null !== (s2 = null !== (i2 = e.headers["Content-Transfer-Encoding"]) && void 0 !== i2 ? i2 : e.encoding) && void 0 !== s2 ? s2 : "base64";
    this.validContentTransferEncodings.includes(r3) || (a2 = "application/octet-stream");
    const o2 = e.headers["Content-ID"];
    "string" == typeof o2 && o2.length > 2 && !o2.startsWith("<") && !o2.endsWith(">") && (e.headers["Content-ID"] = "<" + e.headers["Content-ID"] + ">");
    const d2 = e.inline ? "inline" : "attachment";
    return e.headers = Object.assign({}, e.headers, { "Content-Type": "".concat(a2, '; name="').concat(e.filename, '"'), "Content-Transfer-Encoding": r3, "Content-Disposition": "".concat(d2, '; filename="').concat(e.filename, '"') }), this._addMessage({ data: e.data, headers: e.headers });
  }
  addMessage(e) {
    var t, s2, i2, a2;
    this.isObject(e.headers) || (e.headers = {});
    let r3 = (null !== (t = e.headers["Content-Type"]) && void 0 !== t ? t : e.contentType) || "none";
    if (!this.validTypes.includes(r3)) throw new n("MIMETEXT_INVALID_MESSAGE_TYPE", "Valid content types are ".concat(this.validTypes.join(", "), ' but you specified "').concat(r3, '".'));
    const o2 = null !== (s2 = null !== (i2 = e.headers["Content-Transfer-Encoding"]) && void 0 !== i2 ? i2 : e.encoding) && void 0 !== s2 ? s2 : "7bit";
    this.validContentTransferEncodings.includes(o2) || (r3 = "application/octet-stream");
    const d2 = null !== (a2 = e.charset) && void 0 !== a2 ? a2 : "UTF-8";
    return e.headers = Object.assign({}, e.headers, { "Content-Type": "".concat(r3, "; charset=").concat(d2), "Content-Transfer-Encoding": o2 }), this._addMessage({ data: e.data, headers: e.headers });
  }
  _addMessage(e) {
    const t = new o(this.envctx, e.data, e.headers);
    return this.messages.push(t), t;
  }
  setSender(e) {
    const t = new i(e, arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : { type: "From" });
    return this.setHeader("From", t), t;
  }
  getSender() {
    return this.getHeader("From");
  }
  setRecipients(e) {
    let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : { type: "To" };
    const s2 = (this.isArray(e) ? e : [e]).map(((e2) => new i(e2, t)));
    return this.setHeader(t.type, s2), s2;
  }
  getRecipients() {
    let e = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : { type: "To" };
    return this.getHeader(e.type);
  }
  setRecipient(e) {
    let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : { type: "To" };
    return this.setRecipients(e, t);
  }
  setTo(e) {
    let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : { type: "To" };
    return this.setRecipients(e, t);
  }
  setCc(e) {
    let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : { type: "Cc" };
    return this.setRecipients(e, t);
  }
  setBcc(e) {
    let t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : { type: "Bcc" };
    return this.setRecipients(e, t);
  }
  setSubject(e) {
    return this.setHeader("subject", e), e;
  }
  getSubject() {
    return this.getHeader("subject");
  }
  setHeader(e, t) {
    return this.headers.set(e, t), e;
  }
  getHeader(e) {
    return this.headers.get(e);
  }
  setHeaders(e) {
    return Object.keys(e).map(((t) => this.setHeader(t, e[t])));
  }
  getHeaders() {
    return this.headers.toObject();
  }
  toBase64(e) {
    return this.envctx.toBase64(e);
  }
  toBase64WebSafe(e) {
    return this.envctx.toBase64WebSafe(e);
  }
  generateBoundaries() {
    this.boundaries = { mixed: Math.random().toString(36).slice(2), alt: Math.random().toString(36).slice(2), related: Math.random().toString(36).slice(2) };
  }
  isArray(e) {
    return !!e && e.constructor === Array;
  }
  isObject(e) {
    return !!e && e.constructor === Object;
  }
};
var h = { toBase64: /* @__PURE__ */ __name(function(t) {
  return gBase64.encode(t);
}, "toBase64"), toBase64WebSafe: /* @__PURE__ */ __name(function(t) {
  return gBase64.encodeURI(t);
}, "toBase64WebSafe"), eol: "\r\n", validateContentType: /* @__PURE__ */ __name((e) => e.length > 0 && e, "validateContentType") };
function c() {
  return new d(h);
}
__name(c, "c");

// src/services/email.ts
async function sendVerificationEmail(env2, toEmail, name, verificationUrl) {
  if (!env2.SEND_EMAIL) {
    console.warn(`[EMAIL] No SEND_EMAIL binding configured \u2014 email to ${toEmail} was not sent. Enable Email Routing and add the send_email binding.`);
    return false;
  }
  try {
    const msg = c();
    msg.setSender({ name: "Axal Ventures", addr: "noreply@axal.vc" });
    msg.setRecipient(toEmail);
    msg.setSubject("Verify your email \u2014 Axal Ventures");
    msg.addMessage({
      contentType: "text/html",
      data: buildEmailHTML(name, verificationUrl)
    });
    msg.addMessage({
      contentType: "text/plain",
      data: `Hi ${name},

Thanks for signing up for Axal Ventures. Please verify your email by visiting this link:

${verificationUrl}

This link expires in 24 hours.

If you didn't create an account, you can safely ignore this email.`
    });
    const rawEmail = msg.asRaw();
    const message2 = new EmailMessage("noreply@axal.vc", toEmail, rawEmail);
    await env2.SEND_EMAIL.send(message2);
    console.log(`[EMAIL] Verification email sent to ${toEmail} via Cloudflare Email Routing`);
    return true;
  } catch (e) {
    console.error(`[EMAIL] Cloudflare send_email failed: ${e?.message || "Unknown error"}`);
    return false;
  }
}
__name(sendVerificationEmail, "sendVerificationEmail");
function buildEmailHTML(name, verificationUrl) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:32px 32px 0;">
  <div style="font-size:20px;font-weight:700;color:#7c3aed;margin-bottom:24px;">&#9889; AXAL Ventures</div>
  <div style="width:100%;height:3px;background:linear-gradient(90deg,#7c3aed 50%,#e5e7eb 50%);border-radius:2px;margin-bottom:24px;"></div>
  <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;">Verify Your Email</h1>
  <p style="font-size:14px;color:#6b7280;margin:0 0 24px;line-height:1.6;">
    Hi ${name}, thanks for signing up for Axal Ventures. Please verify your email address to continue setting up your account.
  </p>
</td></tr>
<tr><td style="padding:0 32px;">
  <table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:8px 0 24px;">
    <a href="${verificationUrl}" style="display:inline-block;background:#7c3aed;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px;">
      Verify Email Address
    </a>
  </td></tr>
  </table>
</td></tr>
<tr><td style="padding:0 32px 24px;">
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;">
    <p style="font-size:12px;color:#6b7280;margin:0 0 4px;">Or copy and paste this link into your browser:</p>
    <p style="font-size:12px;color:#7c3aed;margin:0;word-break:break-all;">${verificationUrl}</p>
  </div>
</td></tr>
<tr><td style="padding:0 32px 32px;">
  <p style="font-size:12px;color:#9ca3af;margin:0;line-height:1.5;">
    This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
__name(buildEmailHTML, "buildEmailHTML");

// src/services/turnstile.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
async function verifyTurnstile(env2, token, ip) {
  if (!env2.TURNSTILE_SECRET_KEY) {
    console.warn("[TURNSTILE] No TURNSTILE_SECRET_KEY configured \u2014 bot protection disabled. Set the secret to enable.");
    return true;
  }
  if (!token) {
    console.warn("[TURNSTILE] No token provided");
    return false;
  }
  try {
    const formData = new URLSearchParams();
    formData.append("secret", env2.TURNSTILE_SECRET_KEY);
    formData.append("response", token);
    if (ip) formData.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData
    });
    const data = await res.json();
    if (!data.success) {
      console.warn("[TURNSTILE] Verification failed:", data["error-codes"]);
    }
    return data.success;
  } catch (e) {
    console.error("[TURNSTILE] Verification error:", e);
    return false;
  }
}
__name(verifyTurnstile, "verifyTurnstile");

// src/routes/auth.ts
var auth = new Hono2();
async function checkRateLimit(env2, key, max, windowSec) {
  const data = await env2.RATE_LIMITS.get(key);
  const now = Date.now();
  let attempts = data ? JSON.parse(data) : [];
  attempts = attempts.filter((t) => now - t < windowSec * 1e3);
  if (attempts.length >= max) return false;
  attempts.push(now);
  await env2.RATE_LIMITS.put(key, JSON.stringify(attempts), { expirationTtl: windowSec });
  return true;
}
__name(checkRateLimit, "checkRateLimit");
async function sendVerification(env2, email, name, userId) {
  const rawToken = generateToken();
  const tokenHash = await hashToken(rawToken);
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1e3).toISOString();
  const sql = getSQL(env2);
  await sql`UPDATE users SET verification_token = ${tokenHash}, verification_token_expires = ${expires} WHERE id = ${userId}`;
  await sql.end();
  const verificationUrl = `${env2.APP_URL}/verify-email?token=${rawToken}`;
  try {
    const sent = await sendVerificationEmail(env2, email, name, verificationUrl);
    if (!sent) {
      console.warn(`[AUTH] Email delivery failed for ${email}. Check Email Routing / SEND_EMAIL binding configuration.`);
    }
  } catch (e) {
    console.error(`[AUTH] Email service error for ${email}: ${e?.message || "Unknown error"}`);
  }
}
__name(sendVerification, "sendVerification");
auth.post("/register", async (c2) => {
  const { email, name, role, turnstileToken } = await c2.req.json();
  if (!email || !name) return c2.json({ error: "Email and name required" }, 400);
  if (role && !["founder", "partner"].includes(role)) return c2.json({ error: "Invalid role" }, 400);
  const clientIp = c2.req.header("cf-connecting-ip") || void 0;
  const turnstileOk = await verifyTurnstile(c2.env, turnstileToken, clientIp);
  if (!turnstileOk) return c2.json({ error: "Bot verification failed. Please try again." }, 403);
  const sql = getSQL(c2.env);
  const existing = await sql`SELECT * FROM users WHERE email = ${email}`;
  if (existing.length > 0) {
    const user2 = existing[0];
    if (user2.email_verified && user2.password_hash) {
      await sql.end();
      return c2.json({ error: "Email already registered" }, 409);
    }
    await sql`UPDATE users SET name = ${name}, role = ${role || "partner"} WHERE id = ${user2.id}`;
    await sql.end();
    await sendVerification(c2.env, email, name, user2.id);
    return c2.json({ message: "Verification email sent", email, name, requires_verification: true });
  }
  const [user] = await sql`INSERT INTO users (email, name, role, email_verified) VALUES (${email}, ${name}, ${role || "partner"}, false) RETURNING *`;
  await sql`INSERT INTO activity_logs (action, details, actor) VALUES ('user_registered', ${`User ${name} (${email}) registered as ${role || "partner"} \u2014 pending email verification`}, ${email})`;
  await sql.end();
  await sendVerification(c2.env, email, name, user.id);
  return c2.json({ message: "Verification email sent", email: user.email, name: user.name, requires_verification: true });
});
auth.post("/resend-verification", async (c2) => {
  const { email } = await c2.req.json();
  const allowed = await checkRateLimit(c2.env, `resend:${email.toLowerCase()}`, 3, 3600);
  if (!allowed) return c2.json({ error: "Maximum resend limit reached. Please try again in an hour." }, 429);
  const genericMsg = "If an account exists with that email, a verification link has been sent.";
  const sql = getSQL(c2.env);
  const users2 = await sql`SELECT * FROM users WHERE email = ${email}`;
  await sql.end();
  if (users2.length === 0 || users2[0].email_verified && users2[0].password_hash) {
    return c2.json({ message: genericMsg });
  }
  try {
    await sendVerification(c2.env, email, users2[0].name, users2[0].id);
  } catch {
  }
  return c2.json({ message: genericMsg });
});
auth.get("/verify-email", async (c2) => {
  const token = c2.req.query("token");
  if (!token) return c2.json({ error: "Token required" }, 400);
  const tokenHash = await hashToken(token);
  const sql = getSQL(c2.env);
  const users2 = await sql`SELECT * FROM users WHERE verification_token = ${tokenHash}`;
  await sql.end();
  if (users2.length === 0) return c2.json({ error: "Invalid or expired verification link." }, 400);
  const user = users2[0];
  if (user.verification_token_expires && /* @__PURE__ */ new Date() > new Date(user.verification_token_expires)) {
    return c2.json({ error: "Verification link has expired. Please request a new one." }, 400);
  }
  return c2.json({ valid: true, email: user.email, name: user.name });
});
auth.post("/confirm-verify-email", async (c2) => {
  const { token } = await c2.req.json();
  if (!token) return c2.json({ error: "Token required" }, 400);
  const tokenHash = await hashToken(token);
  const sql = getSQL(c2.env);
  const users2 = await sql`SELECT * FROM users WHERE verification_token = ${tokenHash}`;
  if (users2.length === 0) {
    await sql.end();
    return c2.json({ error: "Invalid or expired verification link." }, 400);
  }
  const user = users2[0];
  if (user.verification_token_expires && /* @__PURE__ */ new Date() > new Date(user.verification_token_expires)) {
    await sql.end();
    return c2.json({ error: "Verification link has expired." }, 400);
  }
  const setupToken = generateToken();
  const setupHash = await hashToken(setupToken);
  const setupExpires = new Date(Date.now() + 24 * 60 * 60 * 1e3).toISOString();
  await sql`UPDATE users SET email_verified = true, verification_token = ${setupHash}, verification_token_expires = ${setupExpires} WHERE id = ${user.id}`;
  await sql`INSERT INTO activity_logs (action, details, actor) VALUES ('email_verified', ${`User ${user.name} (${user.email}) verified their email`}, ${user.email})`;
  await sql.end();
  return c2.json({ verified: true, email: user.email, name: user.name, setup_token: setupToken });
});
auth.post("/setup-totp", async (c2) => {
  const { email, token } = await c2.req.json();
  if (!email || !token) return c2.json({ error: "Email and token required" }, 400);
  const sql = getSQL(c2.env);
  const users2 = await sql`SELECT * FROM users WHERE email = ${email}`;
  if (users2.length === 0) {
    await sql.end();
    return c2.json({ error: "User not found" }, 404);
  }
  const user = users2[0];
  if (!user.email_verified) {
    await sql.end();
    return c2.json({ error: "Email not verified." }, 403);
  }
  const tokenHash = await hashToken(token);
  if (user.verification_token !== tokenHash) {
    await sql.end();
    return c2.json({ error: "Invalid setup token." }, 403);
  }
  if (user.verification_token_expires && /* @__PURE__ */ new Date() > new Date(user.verification_token_expires)) {
    await sql.end();
    return c2.json({ error: "Setup token expired." }, 403);
  }
  if (user.password_hash) {
    await sql.end();
    return c2.json({ error: "TOTP is already configured." }, 409);
  }
  const secret = new Secret();
  const totp = new TOTP({ issuer: "Axal VC StudioOS", label: email, secret });
  const totpSecret = secret.base32;
  await sql`UPDATE users SET password_hash = ${totpSecret}, verification_token = NULL, verification_token_expires = NULL WHERE id = ${user.id}`;
  await sql.end();
  const uri = totp.toString();
  let qrBase64 = null;
  try {
    qrBase64 = await QRCode.toDataURL(uri);
    qrBase64 = qrBase64.replace("data:image/png;base64,", "");
  } catch {
  }
  return c2.json({
    user_id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    totp_secret: totpSecret,
    provisioning_uri: uri,
    qr_code: qrBase64,
    message: "Scan the QR code with your authenticator app, then use the TOTP code to log in."
  });
});
auth.post("/login", async (c2) => {
  const { email, totp_code } = await c2.req.json();
  if (!email || !totp_code) return c2.json({ error: "Email and TOTP code required" }, 400);
  const allowed = await checkRateLimit(c2.env, `login:${email.toLowerCase()}`, 5, 300);
  if (!allowed) return c2.json({ error: "Too many attempts. Try again in 5 minutes." }, 429);
  const sql = getSQL(c2.env);
  const users2 = await sql`SELECT * FROM users WHERE email = ${email}`;
  if (users2.length === 0) {
    await sql.end();
    return c2.json({ error: "Invalid credentials" }, 401);
  }
  const user = users2[0];
  if (!user.email_verified) {
    await sql.end();
    return c2.json({ error: "Please verify your email before logging in." }, 403);
  }
  if (!user.password_hash) {
    await sql.end();
    return c2.json({ error: "Account not set up for TOTP authentication" }, 401);
  }
  if (!user.is_active) {
    await sql.end();
    return c2.json({ error: "Account is inactive" }, 403);
  }
  const totp = new TOTP({ secret: Secret.fromBase32(user.password_hash) });
  const delta = totp.validate({ token: totp_code, window: 1 });
  if (delta === null) {
    await sql.end();
    return c2.json({ error: "Invalid TOTP code" }, 401);
  }
  const jwtToken = await createJWT(c2.env, user.id, user.email, user.role);
  await sql`INSERT INTO activity_logs (action, details, actor) VALUES ('user_login', ${`User ${user.name} logged in`}, ${user.email})`;
  await sql.end();
  return c2.json({
    token: jwtToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    expires_in: 24 * 3600
  });
});
auth.get("/me", async (c2) => {
  const user = await requireAuth(c2);
  return c2.json({ id: user.id, email: user.email, name: user.name, role: user.role, is_active: user.is_active, created_at: user.created_at });
});
auth.post("/verify-totp", async (c2) => {
  const { email, totp_code } = await c2.req.json();
  const allowed = await checkRateLimit(c2.env, `login:${email.toLowerCase()}`, 5, 300);
  if (!allowed) return c2.json({ error: "Too many attempts." }, 429);
  const sql = getSQL(c2.env);
  const users2 = await sql`SELECT * FROM users WHERE email = ${email}`;
  await sql.end();
  if (users2.length === 0 || !users2[0].password_hash) return c2.json({ error: "Invalid credentials" }, 401);
  const totp = new TOTP({ secret: Secret.fromBase32(users2[0].password_hash) });
  const valid = totp.validate({ token: totp_code, window: 1 }) !== null;
  return c2.json({ valid });
});
var auth_default = auth;

// src/routes/scoring.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/services/scoring.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function scoreMarket(tam, urgency, trend) {
  let sizeScore = 3;
  if (tam >= 1e9) sizeScore = 10;
  else if (tam >= 5e8) sizeScore = 8;
  else if (tam >= 1e8) sizeScore = 7;
  else if (tam >= 5e7) sizeScore = 5;
  const urgencyScore = Math.min(Math.max(urgency, 0), 10);
  const trendScore = Math.min(Math.max(trend, 0), 5);
  const total = Math.min(sizeScore + urgencyScore + trendScore, 25);
  return { size: r2(sizeScore), urgency: r2(urgencyScore), trend: r2(trendScore), total: r2(total) };
}
__name(scoreMarket, "scoreMarket");
function scoreTeam(expertise, execution, network) {
  const e = Math.min(Math.max(expertise, 0), 8);
  const x = Math.min(Math.max(execution, 0), 8);
  const n2 = Math.min(Math.max(network, 0), 4);
  const total = Math.min(e + x + n2, 20);
  return { expertise: r2(e), execution: r2(x), network: r2(n2), total: r2(total) };
}
__name(scoreTeam, "scoreTeam");
function scoreProduct(mvpTimeDays, complexity, dependencies) {
  let mvpScore = 1;
  if (mvpTimeDays <= 14) mvpScore = 7;
  else if (mvpTimeDays <= 30) mvpScore = 6;
  else if (mvpTimeDays <= 60) mvpScore = 4;
  else if (mvpTimeDays <= 90) mvpScore = 2;
  const c2 = Math.min(Math.max(5 - complexity, 0), 5);
  const d2 = Math.min(Math.max(3 - dependencies, 0), 3);
  const total = Math.min(mvpScore + c2 + d2, 15);
  return { mvp_time: r2(mvpScore), complexity: r2(c2), dependency: r2(d2), total: r2(total) };
}
__name(scoreProduct, "scoreProduct");
function scoreCapital(costToMvp, timeToRevenueMonths, burnRisk) {
  let costScore = 1;
  if (costToMvp < 25e3) costScore = 7;
  else if (costToMvp < 5e4) costScore = 6;
  else if (costToMvp < 1e5) costScore = 5;
  else if (costToMvp < 2e5) costScore = 3;
  let revenueScore = 0;
  if (timeToRevenueMonths <= 3) revenueScore = 5;
  else if (timeToRevenueMonths <= 6) revenueScore = 4;
  else if (timeToRevenueMonths <= 12) revenueScore = 3;
  else if (timeToRevenueMonths <= 18) revenueScore = 1;
  const burn = Math.min(Math.max(3 - burnRisk, 0), 3);
  const total = Math.min(costScore + revenueScore + burn, 15);
  return { cost_mvp: r2(costScore), time_revenue: r2(revenueScore), burn_traction: r2(burn), total: r2(total) };
}
__name(scoreCapital, "scoreCapital");
function scoreFit(alignment, synergy) {
  const a2 = Math.min(Math.max(alignment, 0), 10);
  const s2 = Math.min(Math.max(synergy, 0), 5);
  const total = Math.min(a2 + s2, 15);
  return { alignment: r2(a2), synergy: r2(s2), total: r2(total) };
}
__name(scoreFit, "scoreFit");
function scoreDistribution(channels, virality) {
  const c2 = Math.min(Math.max(channels, 0), 5);
  const v = Math.min(Math.max(virality, 0), 5);
  const total = Math.min(c2 + v, 10);
  return { channels: r2(c2), virality: r2(v), total: r2(total) };
}
__name(scoreDistribution, "scoreDistribution");
function classifyTier(score) {
  if (score >= 85) return "TIER_1";
  if (score >= 70) return "TIER_2";
  return "REJECT";
}
__name(classifyTier, "classifyTier");
function tierLabel(tier) {
  const labels = {
    TIER_1: "Tier 1 \u2014 Immediate Spinout",
    TIER_2: "Tier 2 \u2014 Conditional / Refine in Week 1",
    REJECT: "Reject \u2014 Incubate Later"
  };
  return labels[tier] || tier;
}
__name(tierLabel, "tierLabel");
function runFullScore(data) {
  const market = scoreMarket(data.tam || 0, data.market_urgency || 0, data.market_trend || 0);
  const team = scoreTeam(data.team_expertise || 0, data.team_execution || 0, data.team_network || 0);
  const product = scoreProduct(data.mvp_time_days || 90, data.product_complexity || 3, data.product_dependencies || 2);
  const capital2 = scoreCapital(data.cost_to_mvp || 1e5, data.time_to_revenue_months || 12, data.burn_risk || 2);
  const fit = scoreFit(data.fit_alignment || 0, data.fit_synergy || 0);
  const distribution = scoreDistribution(data.distribution_channels || 0, data.distribution_virality || 0);
  let total = market.total + team.total + product.total + capital2.total + fit.total + distribution.total;
  const aiAdj = data.ai_adjustment || 0;
  total = Math.min(Math.max(total + aiAdj, 0), 100);
  const tier = classifyTier(total);
  return {
    total_score: r2(total),
    tier,
    tier_label: tierLabel(tier),
    breakdown: { market, team, product, capital: capital2, fit, distribution },
    ai_adjustment: aiAdj,
    max_possible: 100
  };
}
__name(runFullScore, "runFullScore");
function r2(n2) {
  return Math.round(n2 * 10) / 10;
}
__name(r2, "r");

// src/routes/scoring.ts
var scoring = new Hono2();
scoring.post("/score", async (c2) => {
  const user = await requireAuth(c2);
  const body = await c2.req.json();
  const result = runFullScore(body);
  if (body.project_id) {
    const sql = getSQL(c2.env);
    const projects2 = await sql`SELECT * FROM projects WHERE id = ${body.project_id}`;
    if (projects2.length === 0) {
      await sql.end();
      return c2.json({ error: "Project not found" }, 404);
    }
    const b = result.breakdown;
    const [snapshot] = await sql`INSERT INTO score_snapshots (project_id, total_score, tier, market_size, market_urgency, market_trend, market_total, team_expertise, team_execution, team_network, team_total, product_mvp_time, product_complexity, product_dependency, product_total, capital_cost_mvp, capital_time_revenue, capital_burn_traction, capital_total, fit_alignment, fit_synergy, fit_total, distribution_channels, distribution_virality, distribution_total, ai_adjustment) VALUES (${body.project_id}, ${result.total_score}, ${result.tier}, ${b.market.size}, ${b.market.urgency}, ${b.market.trend}, ${b.market.total}, ${b.team.expertise}, ${b.team.execution}, ${b.team.network}, ${b.team.total}, ${b.product.mvp_time}, ${b.product.complexity}, ${b.product.dependency}, ${b.product.total}, ${b.capital.cost_mvp}, ${b.capital.time_revenue}, ${b.capital.burn_traction}, ${b.capital.total}, ${b.fit.alignment}, ${b.fit.synergy}, ${b.fit.total}, ${b.distribution.channels}, ${b.distribution.virality}, ${b.distribution.total}, ${result.ai_adjustment}) RETURNING id`;
    const newStatus = result.total_score >= 85 ? "tier_1" : result.total_score >= 70 ? "tier_2" : "rejected";
    await sql`UPDATE projects SET status = ${newStatus}, updated_at = CURRENT_TIMESTAMP WHERE id = ${body.project_id}`;
    await sql.end();
    return c2.json({ ...result, snapshot_id: snapshot.id });
  }
  return c2.json(result);
});
scoring.post("/score/:projectId/deal-memo", async (c2) => {
  const user = await requireAuth(c2);
  const projectId = parseInt(c2.req.param("projectId"));
  const sql = getSQL(c2.env);
  const projects2 = await sql`SELECT * FROM projects WHERE id = ${projectId}`;
  if (projects2.length === 0) {
    await sql.end();
    return c2.json({ error: "Project not found" }, 404);
  }
  const project = projects2[0];
  const snapshots = await sql`SELECT * FROM score_snapshots WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 1`;
  if (snapshots.length === 0) {
    await sql.end();
    return c2.json({ error: "No score found. Run scoring first." }, 404);
  }
  const snapshot = snapshots[0];
  let founderName = "Unknown";
  if (project.founder_id) {
    const founders = await sql`SELECT name FROM founders WHERE id = ${project.founder_id}`;
    if (founders.length > 0) founderName = founders[0].name;
  }
  const decision = snapshot.tier === "TIER_1" ? "INVEST / SPINOUT" : snapshot.tier === "TIER_2" ? "CONDITIONAL" : "PASS";
  const [memo] = await sql`INSERT INTO deal_memos (project_id, score_snapshot_id, startup_name, founders, sector, stage, total_score, tier, problem, solution, why_now, users, revenue_info, growth_signals, cost_to_mvp, funding_needed, use_of_funds, decision) VALUES (${project.id}, ${snapshot.id}, ${project.name}, ${founderName}, ${project.sector}, ${project.stage}, ${snapshot.total_score}, ${snapshot.tier}, ${project.problem_statement}, ${project.solution}, ${project.why_now}, ${project.users_count?.toString() || null}, ${project.revenue?.toString() || null}, ${project.growth_signals}, ${project.cost_to_mvp?.toString() || null}, ${project.funding_needed?.toString() || null}, ${project.use_of_funds}, ${decision}) RETURNING *`;
  await sql.end();
  return c2.json({
    id: memo.id,
    startup_name: memo.startup_name,
    founders: memo.founders,
    sector: memo.sector,
    stage: memo.stage,
    score: memo.total_score,
    tier: memo.tier,
    tier_label: tierLabel(memo.tier),
    problem: memo.problem,
    solution: memo.solution,
    why_now: memo.why_now,
    traction: { users: memo.users, revenue: memo.revenue_info, growth_signals: memo.growth_signals },
    economics: { cost_to_mvp: memo.cost_to_mvp, funding_needed: memo.funding_needed, use_of_funds: memo.use_of_funds },
    axal_fit: { strategic_alignment: memo.strategic_alignment, partner_synergies: memo.partner_synergies },
    risks: memo.risks,
    decision: memo.decision,
    terms: { amount: memo.terms_amount, equity: memo.terms_equity, structure: memo.terms_structure }
  });
});
scoring.get("/scores/:projectId", async (c2) => {
  await requireAuth(c2);
  const projectId = parseInt(c2.req.param("projectId"));
  const sql = getSQL(c2.env);
  const snapshots = await sql`SELECT * FROM score_snapshots WHERE project_id = ${projectId} ORDER BY created_at DESC`;
  await sql.end();
  return c2.json(snapshots);
});
scoring.get("/deal-memos/:projectId", async (c2) => {
  const projectId = parseInt(c2.req.param("projectId"));
  const sql = getSQL(c2.env);
  const memos = await sql`SELECT * FROM deal_memos WHERE project_id = ${projectId} ORDER BY created_at DESC`;
  await sql.end();
  return c2.json(memos);
});
scoring.get("/queue", async (c2) => {
  const sql = getSQL(c2.env);
  const projects2 = await sql`SELECT * FROM projects WHERE status IN ('intake', 'scoring') ORDER BY created_at DESC`;
  await sql.end();
  return c2.json(projects2);
});
scoring.post("/generateMemo", async (c2) => {
  const data = await c2.req.json();
  return c2.json({
    startup_name: data.startup_name,
    ai_generated: false,
    memo: {
      problem_analysis: `${data.startup_name || "Unknown"} is addressing: ${data.problem || "N/A"}. The ${data.sector || "technology"} sector presents a market opportunity.`,
      solution_assessment: `Proposed solution: ${data.solution || "N/A"}. Requires further technical diligence.`,
      traction_summary: data.traction || "Early stage \u2014 pre-traction.",
      risk_assessment: ["Market timing and competitive dynamics need validation", "Team execution capability requires further assessment", "Capital efficiency needs detailed burn analysis"],
      decision: "CONDITIONAL \u2014 requires deeper diligence on team and market validation",
      key_insight: `The ${data.sector || "technology"} opportunity warrants exploration given current market dynamics.`
    }
  });
});
var scoring_default = scoring;

// src/routes/projects.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var projects = new Hono2();
projects.get("/", async (c2) => {
  await requireAuth(c2);
  const status = c2.req.query("status");
  const sql = getSQL(c2.env);
  const rows = status ? await sql`SELECT * FROM projects WHERE status = ${status} ORDER BY created_at DESC` : await sql`SELECT * FROM projects ORDER BY created_at DESC`;
  await sql.end();
  return c2.json(rows);
});
projects.get("/:id", async (c2) => {
  await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (rows.length === 0) {
    await sql.end();
    return c2.json({ error: "Project not found" }, 404);
  }
  const project = rows[0];
  let founder = null;
  if (project.founder_id) {
    const f = await sql`SELECT * FROM founders WHERE id = ${project.founder_id}`;
    if (f.length > 0) founder = f[0];
  }
  await sql.end();
  return c2.json({ ...project, founder });
});
projects.post("/", async (c2) => {
  await requireAuth(c2);
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  let founderId = null;
  if (data.founder_email) {
    const existing = await sql`SELECT id FROM founders WHERE email = ${data.founder_email}`;
    if (existing.length > 0) {
      founderId = existing[0].id;
    } else {
      const [f] = await sql`INSERT INTO founders (name, email) VALUES (${data.founder_name || "Unknown"}, ${data.founder_email}) RETURNING id`;
      founderId = f.id;
    }
  }
  const [project] = await sql`INSERT INTO projects (name, description, sector, stage, founder_id, problem_statement, solution, why_now, tam, sam, cost_to_mvp, funding_needed, use_of_funds) VALUES (${data.name}, ${data.description || null}, ${data.sector || null}, ${data.stage || "idea"}, ${founderId}, ${data.problem_statement || null}, ${data.solution || null}, ${data.why_now || null}, ${data.tam || null}, ${data.sam || null}, ${data.cost_to_mvp || null}, ${data.funding_needed || null}, ${data.use_of_funds || null}) RETURNING *`;
  await sql`INSERT INTO deals (project_id, status) VALUES (${project.id}, 'applied')`;
  await sql`INSERT INTO activity_logs (project_id, action, details) VALUES (${project.id}, 'project_created', ${`Project '${project.name}' submitted`})`;
  await sql.end();
  return c2.json(project, 201);
});
projects.post("/submit", async (c2) => {
  await requireAuth(c2);
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  const existingFounders = await sql`SELECT id FROM founders WHERE email = ${data.founder_email}`;
  let founderId;
  if (existingFounders.length > 0) {
    founderId = existingFounders[0].id;
  } else {
    const [f] = await sql`INSERT INTO founders (name, email) VALUES (${data.founder_name}, ${data.founder_email}) RETURNING id`;
    founderId = f.id;
  }
  const [project] = await sql`INSERT INTO projects (name, description, sector, stage, founder_id, problem_statement, solution, why_now, tam, sam, cost_to_mvp, funding_needed, use_of_funds) VALUES (${data.name}, ${data.description || null}, ${data.sector || null}, 'idea', ${founderId}, ${data.problem_statement || null}, ${data.solution || null}, ${data.why_now || null}, ${data.tam || null}, ${data.sam || null}, ${data.cost_to_mvp || null}, ${data.funding_needed || null}, ${data.use_of_funds || null}) RETURNING *`;
  const result = runFullScore(data);
  const b = result.breakdown;
  const [snapshot] = await sql`INSERT INTO score_snapshots (project_id, total_score, tier, market_size, market_urgency, market_trend, market_total, team_expertise, team_execution, team_network, team_total, product_mvp_time, product_complexity, product_dependency, product_total, capital_cost_mvp, capital_time_revenue, capital_burn_traction, capital_total, fit_alignment, fit_synergy, fit_total, distribution_channels, distribution_virality, distribution_total, ai_adjustment, scored_by) VALUES (${project.id}, ${result.total_score}, ${result.tier}, ${b.market.size}, ${b.market.urgency}, ${b.market.trend}, ${b.market.total}, ${b.team.expertise}, ${b.team.execution}, ${b.team.network}, ${b.team.total}, ${b.product.mvp_time}, ${b.product.complexity}, ${b.product.dependency}, ${b.product.total}, ${b.capital.cost_mvp}, ${b.capital.time_revenue}, ${b.capital.burn_traction}, ${b.capital.total}, ${b.fit.alignment}, ${b.fit.synergy}, ${b.fit.total}, ${b.distribution.channels}, ${b.distribution.virality}, ${b.distribution.total}, 0, 'auto') RETURNING *`;
  let newStatus = "rejected", dealStatus = "rejected", newStage = project.stage;
  if (result.total_score >= 85) {
    newStatus = "tier_1";
    newStage = "build";
    dealStatus = "active";
  } else if (result.total_score >= 70) {
    newStatus = "tier_2";
    dealStatus = "scored";
  }
  await sql`UPDATE projects SET status = ${newStatus}, stage = ${newStage}, updated_at = CURRENT_TIMESTAMP WHERE id = ${project.id}`;
  await sql`INSERT INTO deals (project_id, status) VALUES (${project.id}, ${dealStatus})`;
  await sql`INSERT INTO activity_logs (project_id, action, details, actor) VALUES (${project.id}, 'auto_scored', ${`Score: ${result.total_score}, Tier: ${result.tier}, Status: ${newStatus}`}, 'system')`;
  await sql.end();
  return c2.json({
    project: { ...project, status: newStatus, stage: newStage },
    score: result,
    auto_decision: { status: newStatus, stage: newStage, tier: result.tier, tier_label: result.tier_label }
  });
});
projects.put("/:id", async (c2) => {
  await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (rows.length === 0) {
    await sql.end();
    return c2.json({ error: "Project not found" }, 404);
  }
  const fields = ["name", "description", "sector", "stage", "status", "playbook_week", "problem_statement", "solution", "why_now", "tam", "sam", "users_count", "revenue", "growth_signals", "cost_to_mvp", "funding_needed", "use_of_funds"];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (data[f] !== void 0) {
      updates.push(`${f} = ?`);
      values.push(data[f]);
    }
  }
  if (updates.length > 0) {
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    await sql.unsafe(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`, [...values, id]);
  }
  const [updated] = await sql`SELECT * FROM projects WHERE id = ${id}`;
  await sql.end();
  return c2.json(updated);
});
projects.delete("/:id", async (c2) => {
  await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT id FROM projects WHERE id = ${id}`;
  if (rows.length === 0) {
    await sql.end();
    return c2.json({ error: "Project not found" }, 404);
  }
  await sql`DELETE FROM projects WHERE id = ${id}`;
  await sql.end();
  return c2.json({ ok: true });
});
projects.post("/:id/advance-week", async (c2) => {
  await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (rows.length === 0) {
    await sql.end();
    return c2.json({ error: "Project not found" }, 404);
  }
  const order = ["week_1", "week_2", "week_3", "week_4", "complete"];
  const idx = order.indexOf(rows[0].playbook_week);
  if (idx >= 0 && idx < order.length - 1) {
    await sql`UPDATE projects SET playbook_week = ${order[idx + 1]}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }
  const [updated] = await sql`SELECT * FROM projects WHERE id = ${id}`;
  await sql.end();
  return c2.json(updated);
});
var projects_default = projects;

// src/routes/legal.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var legal = new Hono2();
var TEMPLATE_LAYERS = {
  gp: { label: "Internal Management (GP Level)", description: "Governance, partner economics, and decision-making framework" },
  fund: { label: "Fund Formation (LP Level)", description: "Capital raising, investor agreements, and fund structure" },
  portfolio: { label: "Investment Execution (Portfolio Level)", description: "Templates used when investing into startups" },
  compliance: { label: "Compliance & Regulatory", description: "SEC filings, AML/KYC, and tax elections" }
};
var TEMPLATES = {
  operating_agreement: { title: "Operating Agreement (LLC)", layer: "gp", content: "OPERATING AGREEMENT OF {company_name} LLC..." },
  carried_interest: { title: "Carried Interest / Partnership Agreement", layer: "gp", content: "CARRIED INTEREST VESTING AGREEMENT..." },
  ic_charter: { title: "Investment Committee Charter", layer: "gp", content: "INVESTMENT COMMITTEE CHARTER..." },
  service_agreement: { title: "Partner Service Agreement", layer: "gp", content: "PARTNER SERVICE AGREEMENT..." },
  lpa: { title: "Limited Partnership Agreement (LPA)", layer: "fund", content: "LIMITED PARTNERSHIP AGREEMENT..." },
  ppm: { title: "Private Placement Memorandum (PPM)", layer: "fund", content: "CONFIDENTIAL PRIVATE PLACEMENT MEMORANDUM..." },
  subscription: { title: "Subscription Agreement", layer: "fund", content: "SUBSCRIPTION AGREEMENT..." },
  mgmt_company: { title: "Management Company Agreement", layer: "fund", content: "MANAGEMENT COMPANY AGREEMENT..." },
  safe: { title: "SAFE Agreement", layer: "portfolio", content: "SIMPLE AGREEMENT FOR FUTURE EQUITY (SAFE)..." },
  term_sheet: { title: "Term Sheet", layer: "portfolio", content: "TERM SHEET \u2014 NON-BINDING..." },
  bylaws: { title: "Corporate Bylaws", layer: "portfolio", content: "BYLAWS OF {company_name}..." },
  equity_split: { title: "Equity Split Agreement", layer: "portfolio", content: "EQUITY ALLOCATION AGREEMENT..." },
  ip_license: { title: "IP License Agreement", layer: "portfolio", content: "INTELLECTUAL PROPERTY LICENSE AGREEMENT..." },
  spa: { title: "Stock Purchase Agreement (SPA)", layer: "portfolio", content: "STOCK PURCHASE AGREEMENT..." },
  voting_rights: { title: "Voting & Investors' Rights Agreement", layer: "portfolio", content: "INVESTORS' RIGHTS AGREEMENT..." },
  form_adv: { title: "Form ADV / Investment Adviser Registration", layer: "compliance", content: "FORM ADV \u2014 INVESTMENT ADVISER REGISTRATION..." },
  aml_kyc: { title: "AML/KYC Policy", layer: "compliance", content: "ANTI-MONEY LAUNDERING AND KNOW YOUR CUSTOMER POLICY..." },
  section_83b: { title: "Section 83(b) Election", layer: "compliance", content: "SECTION 83(b) ELECTION..." }
};
legal.get("/templates", async (c2) => {
  await requireAuth(c2);
  const layers = Object.entries(TEMPLATE_LAYERS).map(([key, val]) => ({
    layer_key: key,
    ...val,
    templates: Object.entries(TEMPLATES).filter(([, t]) => t.layer === key).map(([k, t]) => ({ key: k, title: t.title }))
  }));
  return c2.json({ layers, total_templates: Object.keys(TEMPLATES).length });
});
legal.get("/templates/:key", async (c2) => {
  await requireAuth(c2);
  const key = c2.req.param("key");
  const template = TEMPLATES[key];
  if (!template) return c2.json({ error: "Template not found" }, 404);
  return c2.json({ key, ...template, layer_info: TEMPLATE_LAYERS[template.layer] });
});
legal.post("/templates/:key/generate", async (c2) => {
  await requireAuth(c2);
  const key = c2.req.param("key");
  const template = TEMPLATES[key];
  if (!template) return c2.json({ error: "Template not found" }, 404);
  const body = await c2.req.json();
  let content = template.content;
  if (body.company_name) content = content.replace(/\{company_name\}/g, body.company_name);
  if (body.project_id) content = content.replace(/\{project_id\}/g, body.project_id);
  const sql = getSQL(c2.env);
  const [doc] = await sql`INSERT INTO documents (project_id, title, doc_type, status, content, template_name) VALUES (${body.project_id || null}, ${template.title}, ${key}, 'generated', ${content}, ${key}) RETURNING *`;
  await sql.end();
  return c2.json(doc, 201);
});
legal.get("/documents", async (c2) => {
  await requireAuth(c2);
  const projectId = c2.req.query("project_id");
  const sql = getSQL(c2.env);
  const docs = projectId ? await sql`SELECT * FROM documents WHERE project_id = ${parseInt(projectId)} ORDER BY created_at DESC` : await sql`SELECT * FROM documents ORDER BY created_at DESC`;
  await sql.end();
  return c2.json(docs);
});
legal.get("/documents/:id", async (c2) => {
  await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM documents WHERE id = ${id}`;
  await sql.end();
  if (rows.length === 0) return c2.json({ error: "Document not found" }, 404);
  return c2.json(rows[0]);
});
legal.post("/documents", async (c2) => {
  await requireAuth(c2);
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  const [doc] = await sql`INSERT INTO documents (project_id, title, doc_type, content, template_name) VALUES (${data.project_id || null}, ${data.title}, ${data.doc_type || "other"}, ${data.content || null}, ${data.template_name || null}) RETURNING *`;
  await sql.end();
  return c2.json(doc, 201);
});
legal.put("/documents/:id/sign", async (c2) => {
  await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const { signed_by } = await c2.req.json();
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM documents WHERE id = ${id}`;
  if (rows.length === 0) {
    await sql.end();
    return c2.json({ error: "Document not found" }, 404);
  }
  await sql`UPDATE documents SET status = 'signed', signed_by = ${signed_by || "Unknown"}, signed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  const [updated] = await sql`SELECT * FROM documents WHERE id = ${id}`;
  await sql.end();
  return c2.json(updated);
});
legal.get("/entities", async (c2) => {
  await requireAuth(c2);
  const sql = getSQL(c2.env);
  const entities = await sql`SELECT * FROM entities ORDER BY created_at DESC`;
  await sql.end();
  return c2.json(entities);
});
legal.post("/entities", async (c2) => {
  await requireAuth(c2);
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  const [entity] = await sql`INSERT INTO entities (name, entity_type, parent_id, jurisdiction) VALUES (${data.name}, ${data.entity_type}, ${data.parent_id || null}, ${data.jurisdiction || null}) RETURNING *`;
  await sql.end();
  return c2.json(entity, 201);
});
var legal_default = legal;

// src/routes/partners.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var partners = new Hono2();
partners.get("/", async (c2) => {
  await requireAuth(c2);
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM partners ORDER BY created_at DESC`;
  await sql.end();
  return c2.json(rows);
});
partners.post("/", async (c2) => {
  await requireAuth(c2);
  const data = await c2.req.json();
  const refCode = `AXAL-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const sql = getSQL(c2.env);
  const [partner] = await sql`INSERT INTO partners (name, company, email, specialization, referral_code) VALUES (${data.name}, ${data.company || null}, ${data.email}, ${data.specialization || null}, ${refCode}) RETURNING *`;
  await sql.end();
  return c2.json(partner, 201);
});
partners.get("/:id", async (c2) => {
  await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM partners WHERE id = ${id}`;
  await sql.end();
  if (rows.length === 0) return c2.json({ error: "Partner not found" }, 404);
  return c2.json(rows[0]);
});
partners.get("/referral/:code", async (c2) => {
  await requireAuth(c2);
  const code = c2.req.param("code");
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM partners WHERE referral_code = ${code}`;
  await sql.end();
  if (rows.length === 0) return c2.json({ error: "Invalid referral code" }, 404);
  return c2.json(rows[0]);
});
partners.post("/referral/:code/use", async (c2) => {
  await requireAuth(c2);
  const code = c2.req.param("code");
  const sql = getSQL(c2.env);
  const rows = await sql`UPDATE partners SET referrals_count = referrals_count + 1 WHERE referral_code = ${code} RETURNING *`;
  await sql.end();
  if (rows.length === 0) return c2.json({ error: "Invalid referral code" }, 404);
  return c2.json({ message: "Referral tracked", partner: rows[0] });
});
partners.get("/matchmaking/recommend", async (c2) => {
  await requireAuth(c2);
  const sector = c2.req.query("sector");
  const sql = getSQL(c2.env);
  const rows = sector ? await sql`SELECT * FROM partners WHERE status = 'active' AND specialization LIKE ${"%" + sector + "%"}` : await sql`SELECT * FROM partners WHERE status = 'active'`;
  await sql.end();
  return c2.json({ matches: rows, count: rows.length });
});
partners.post("/matchPartners", async (c2) => {
  await requireAuth(c2);
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  const allPartners = await sql`SELECT * FROM partners WHERE status = 'active'`;
  await sql.end();
  const ranked = allPartners.map((p) => {
    let score = 10;
    const reasons = [];
    if (data.sector && p.specialization) {
      const specs = p.specialization.toLowerCase().replace(/\//g, ",").split(",").map((s2) => s2.trim());
      if (specs.includes(data.sector.toLowerCase())) {
        score += 40;
        reasons.push(`Sector match: ${p.specialization}`);
      }
    }
    if (data.expertise_needed && p.specialization) {
      for (const kw of data.expertise_needed.split(",")) {
        if (p.specialization.toLowerCase().includes(kw.trim().toLowerCase())) {
          score += 20;
          reasons.push(`Expertise match: ${kw.trim()}`);
        }
      }
    }
    if (p.referrals_count > 0) {
      score += Math.min(p.referrals_count * 5, 20);
      reasons.push(`Referral track record: ${p.referrals_count}`);
    }
    return { partner_id: p.id, name: p.name, company: p.company, specialization: p.specialization, match_score: Math.min(score, 100), reasons, referral_code: p.referral_code };
  }).sort((a2, b) => b.match_score - a2.match_score);
  return c2.json({ startup_id: data.startup_id, matches: ranked, total_matched: ranked.length });
});
var partners_default = partners;

// src/routes/capital.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var capital = new Hono2();
capital.get("/investors", async (c2) => {
  await requireAuth(c2);
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM lp_investors ORDER BY created_at DESC`;
  await sql.end();
  return c2.json(rows);
});
capital.post("/investors", async (c2) => {
  await requireAuth(c2);
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  const [inv] = await sql`INSERT INTO lp_investors (name, email, committed_capital, fund_name) VALUES (${data.name}, ${data.email}, ${data.committed_capital || 0}, ${data.fund_name || null}) RETURNING *`;
  await sql.end();
  return c2.json(inv, 201);
});
capital.get("/investors/:id", async (c2) => {
  await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const sql = getSQL(c2.env);
  const invs = await sql`SELECT * FROM lp_investors WHERE id = ${id}`;
  if (invs.length === 0) {
    await sql.end();
    return c2.json({ error: "Investor not found" }, 404);
  }
  const calls = await sql`SELECT * FROM capital_calls WHERE lp_investor_id = ${id}`;
  await sql.end();
  return c2.json({ ...invs[0], capital_calls: calls });
});
capital.post("/calls", async (c2) => {
  await requireAuth(c2);
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  const inv = await sql`SELECT id FROM lp_investors WHERE id = ${data.lp_investor_id}`;
  if (inv.length === 0) {
    await sql.end();
    return c2.json({ error: "Investor not found" }, 404);
  }
  const [call] = await sql`INSERT INTO capital_calls (lp_investor_id, project_id, amount, due_date) VALUES (${data.lp_investor_id}, ${data.project_id || null}, ${data.amount}, ${data.due_date || null}) RETURNING *`;
  await sql.end();
  return c2.json(call, 201);
});
capital.get("/calls", async (c2) => {
  await requireAuth(c2);
  const status = c2.req.query("status");
  const sql = getSQL(c2.env);
  const rows = status ? await sql`SELECT * FROM capital_calls WHERE status = ${status} ORDER BY created_at DESC` : await sql`SELECT * FROM capital_calls ORDER BY created_at DESC`;
  await sql.end();
  return c2.json(rows);
});
capital.post("/calls/:id/pay", async (c2) => {
  await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const sql = getSQL(c2.env);
  const calls = await sql`SELECT * FROM capital_calls WHERE id = ${id}`;
  if (calls.length === 0) {
    await sql.end();
    return c2.json({ error: "Capital call not found" }, 404);
  }
  await sql`UPDATE capital_calls SET status = 'paid', paid_date = date('now') WHERE id = ${id}`;
  await sql`UPDATE lp_investors SET called_capital = called_capital + ${calls[0].amount} WHERE id = ${calls[0].lp_investor_id}`;
  const [updated] = await sql`SELECT * FROM capital_calls WHERE id = ${id}`;
  await sql.end();
  return c2.json({ status: "paid", call: updated });
});
capital.post("/capitalCall", async (c2) => {
  await requireAuth(c2);
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  const projects2 = await sql`SELECT * FROM projects WHERE id = ${data.startup_id}`;
  if (projects2.length === 0) {
    await sql.end();
    return c2.json({ error: "Startup/project not found" }, 404);
  }
  const investors = await sql`SELECT * FROM lp_investors WHERE status = 'active'`;
  if (investors.length === 0) {
    await sql.end();
    return c2.json({ error: "No active investors found" }, 404);
  }
  const perInvestor = data.amount / investors.length;
  const callsCreated = [];
  for (const inv of investors) {
    await sql`INSERT INTO capital_calls (lp_investor_id, project_id, amount) VALUES (${inv.id}, ${data.startup_id}, ${Math.round(perInvestor * 100) / 100})`;
    callsCreated.push({ investor_id: inv.id, investor_name: inv.name, amount: Math.round(perInvestor * 100) / 100 });
  }
  const allPartners = await sql`SELECT * FROM partners WHERE status = 'active'`;
  await sql.end();
  const participating = allPartners.filter((p) => p.specialization && projects2[0].sector && projects2[0].sector.toLowerCase().includes(p.specialization.toLowerCase().split(",")[0]?.trim()));
  return c2.json({
    startup_id: data.startup_id,
    startup_name: projects2[0].name,
    total_amount: data.amount,
    calls_created: callsCreated,
    participating_partners: participating.map((p) => ({ partner_id: p.id, name: p.name, company: p.company, specialization: p.specialization }))
  });
});
capital.get("/portfolio", async (c2) => {
  await requireAuth(c2);
  const sql = getSQL(c2.env);
  const projects2 = await sql`SELECT * FROM projects WHERE status IN ('spinout', 'active', 'tier_1', 'tier_2')`;
  const portfolio = [];
  for (const p of projects2) {
    const scores = await sql`SELECT total_score, tier FROM score_snapshots WHERE project_id = ${p.id} ORDER BY created_at DESC LIMIT 1`;
    portfolio.push({ id: p.id, name: p.name, sector: p.sector, status: p.status, playbook_week: p.playbook_week, score: scores[0]?.total_score || null, tier: scores[0]?.tier || null, revenue: p.revenue, users: p.users_count });
  }
  const committed = await sql`SELECT COALESCE(SUM(committed_capital), 0) as total FROM lp_investors`;
  const called = await sql`SELECT COALESCE(SUM(called_capital), 0) as total FROM lp_investors`;
  await sql.end();
  return c2.json({ projects: portfolio, total_projects: portfolio.length, fund_metrics: { total_committed: committed[0].total, total_called: called[0].total } });
});
var capital_default = capital;

// src/routes/deals.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var deals = new Hono2();
deals.get("/", async (c2) => {
  await requireAuth(c2);
  const status = c2.req.query("status");
  const sql = getSQL(c2.env);
  const rows = status ? await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id WHERE d.status = ${status} ORDER BY d.created_at DESC` : await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id ORDER BY d.created_at DESC`;
  await sql.end();
  return c2.json(rows);
});
deals.post("/", async (c2) => {
  await requireAuth(c2);
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  const p = await sql`SELECT id FROM projects WHERE id = ${data.project_id}`;
  if (p.length === 0) {
    await sql.end();
    return c2.json({ error: "Project not found" }, 404);
  }
  const [deal] = await sql`INSERT INTO deals (project_id, partner_id, status, notes, amount) VALUES (${data.project_id}, ${data.partner_id || null}, ${data.status || "applied"}, ${data.notes || null}, ${data.amount || null}) RETURNING *`;
  await sql.end();
  return c2.json(deal, 201);
});
deals.get("/:id", async (c2) => {
  await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT d.*, p.name as project_name, pr.name as partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id WHERE d.id = ${id}`;
  await sql.end();
  if (rows.length === 0) return c2.json({ error: "Deal not found" }, 404);
  return c2.json(rows[0]);
});
deals.put("/:id", async (c2) => {
  await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT id FROM deals WHERE id = ${id}`;
  if (rows.length === 0) {
    await sql.end();
    return c2.json({ error: "Deal not found" }, 404);
  }
  if (data.status) await sql`UPDATE deals SET status = ${data.status}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.partner_id !== void 0) await sql`UPDATE deals SET partner_id = ${data.partner_id}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.notes !== void 0) await sql`UPDATE deals SET notes = ${data.notes}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.amount !== void 0) await sql`UPDATE deals SET amount = ${data.amount}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  const [updated] = await sql`SELECT * FROM deals WHERE id = ${id}`;
  await sql.end();
  return c2.json(updated);
});
var deals_default = deals;

// src/routes/tickets.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var tickets = new Hono2();
tickets.get("/", async (c2) => {
  const user = await requireAuth(c2);
  const status = c2.req.query("status");
  const sql = getSQL(c2.env);
  let rows;
  if (user.role === "admin") {
    rows = status ? await sql`SELECT * FROM tickets WHERE status = ${status} ORDER BY created_at DESC` : await sql`SELECT * FROM tickets ORDER BY created_at DESC`;
  } else {
    rows = status ? await sql`SELECT * FROM tickets WHERE user_id = ${user.id} AND status = ${status} ORDER BY created_at DESC` : await sql`SELECT * FROM tickets WHERE user_id = ${user.id} ORDER BY created_at DESC`;
  }
  await sql.end();
  return c2.json(rows);
});
tickets.post("/", async (c2) => {
  const user = await requireAuth(c2);
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  const [ticket] = await sql`INSERT INTO tickets (title, description, priority, submitted_by, user_id, project_id) VALUES (${data.title}, ${data.description || null}, ${data.priority || "medium"}, ${user.name || user.email}, ${user.id}, ${data.project_id || null}) RETURNING *`;
  await sql.end();
  let githubIssue = null;
  if (c2.env.GITHUB_ACCESS_TOKEN) {
    try {
      const resp = await fetch(`https://api.github.com/repos/${c2.env.GITHUB_REPO_OWNER}/${c2.env.GITHUB_REPO_NAME}/issues`, {
        method: "POST",
        headers: { Authorization: `Bearer ${c2.env.GITHUB_ACCESS_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
        body: JSON.stringify({ title: data.title, body: `${data.description || ""}

---
**Submitted by:** ${user.name}
**Priority:** ${data.priority || "medium"}
**Source:** StudioOS`, labels: [`priority: ${data.priority || "medium"}`, "support-ticket"] })
      });
      if (resp.ok) githubIssue = await resp.json();
    } catch {
    }
  }
  return c2.json({ ...ticket, github_issue: githubIssue ? { number: githubIssue.number, url: githubIssue.html_url } : null, github_sync_status: githubIssue ? "synced" : "failed" });
});
tickets.get("/:id", async (c2) => {
  const user = await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  await sql.end();
  if (rows.length === 0) return c2.json({ error: "Ticket not found" }, 404);
  if (user.role !== "admin" && rows[0].user_id !== user.id) return c2.json({ error: "Access denied" }, 403);
  return c2.json(rows[0]);
});
tickets.put("/:id", async (c2) => {
  const user = await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  if (rows.length === 0) {
    await sql.end();
    return c2.json({ error: "Ticket not found" }, 404);
  }
  if (user.role !== "admin" && rows[0].user_id !== user.id) {
    await sql.end();
    return c2.json({ error: "Access denied" }, 403);
  }
  if (data.status) await sql`UPDATE tickets SET status = ${data.status}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.assigned_to) {
    if (user.role !== "admin") {
      await sql.end();
      return c2.json({ error: "Only admins can assign tickets" }, 403);
    }
    await sql`UPDATE tickets SET assigned_to = ${data.assigned_to}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }
  const [updated] = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  await sql.end();
  return c2.json(updated);
});
var tickets_default = tickets;

// src/routes/users.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var users = new Hono2();
users.get("/", async (c2) => {
  await requireAuth(c2);
  const role = c2.req.query("role");
  const sql = getSQL(c2.env);
  const rows = role ? await sql`SELECT id, uid, email, name, role, is_active, email_verified, created_at FROM users WHERE role = ${role} ORDER BY created_at DESC` : await sql`SELECT id, uid, email, name, role, is_active, email_verified, created_at FROM users ORDER BY created_at DESC`;
  await sql.end();
  return c2.json(rows);
});
users.post("/", async (c2) => {
  await requireAdmin(c2);
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  const existing = await sql`SELECT id FROM users WHERE email = ${data.email}`;
  if (existing.length > 0) {
    await sql.end();
    return c2.json({ error: "User with this email already exists" }, 409);
  }
  const validRole = ["founder", "partner"].includes(data.role) ? data.role : "partner";
  const [user] = await sql`INSERT INTO users (email, name, role, founder_id, partner_id) VALUES (${data.email}, ${data.name}, ${validRole}, ${data.founder_id || null}, ${data.partner_id || null}) RETURNING id, uid, email, name, role, is_active, email_verified, created_at`;
  await sql.end();
  return c2.json(user, 201);
});
users.get("/:id", async (c2) => {
  await requireAuth(c2);
  const id = parseInt(c2.req.param("id"));
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT id, uid, email, name, role, is_active, email_verified, founder_id, partner_id, created_at FROM users WHERE id = ${id}`;
  if (rows.length === 0) {
    await sql.end();
    return c2.json({ error: "User not found" }, 404);
  }
  const result = { ...rows[0] };
  if (rows[0].founder_id) {
    const f = await sql`SELECT * FROM founders WHERE id = ${rows[0].founder_id}`;
    if (f.length > 0) result.founder = f[0];
  }
  if (rows[0].partner_id) {
    const p = await sql`SELECT * FROM partners WHERE id = ${rows[0].partner_id}`;
    if (p.length > 0) result.partner = p[0];
  }
  await sql.end();
  return c2.json(result);
});
var users_default = users;

// src/routes/admin.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var admin = new Hono2();
admin.get("/users", async (c2) => {
  await requireAdmin(c2);
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT id, uid, email, name, role, is_active, email_verified, created_at FROM users ORDER BY created_at DESC`;
  await sql.end();
  return c2.json(rows);
});
admin.post("/impersonate/:userId", async (c2) => {
  const adminUser = await requireAdmin(c2);
  const userId = parseInt(c2.req.param("userId"));
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (rows.length === 0) {
    await sql.end();
    return c2.json({ error: "User not found" }, 404);
  }
  const target = rows[0];
  const token = await createJWT(c2.env, target.id, target.email, target.role, adminUser.id);
  await sql`INSERT INTO activity_logs (action, details, actor) VALUES ('admin_impersonate', ${`Admin ${adminUser.name} impersonated user ${target.name} (${target.email})`}, ${adminUser.email})`;
  await sql.end();
  return c2.json({ token, user: { id: target.id, email: target.email, name: target.name, role: target.role } });
});
admin.patch("/users/:userId/role", async (c2) => {
  const adminUser = await requireAdmin(c2);
  const userId = parseInt(c2.req.param("userId"));
  const { role } = await c2.req.json();
  if (!["admin", "founder", "partner"].includes(role)) return c2.json({ error: `Invalid role: ${role}` }, 400);
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (rows.length === 0) {
    await sql.end();
    return c2.json({ error: "User not found" }, 404);
  }
  if (rows[0].id === adminUser.id) {
    await sql.end();
    return c2.json({ error: "Cannot change your own role" }, 400);
  }
  const oldRole = rows[0].role;
  await sql`UPDATE users SET role = ${role} WHERE id = ${userId}`;
  await sql`INSERT INTO activity_logs (action, details, actor) VALUES ('role_changed', ${`Admin ${adminUser.name} changed ${rows[0].name}'s role from ${oldRole} to ${role}`}, ${adminUser.email})`;
  await sql.end();
  return c2.json({ message: `Role updated to ${role}`, user_id: userId, role });
});
admin.patch("/users/:userId/toggle-active", async (c2) => {
  const adminUser = await requireAdmin(c2);
  const userId = parseInt(c2.req.param("userId"));
  const sql = getSQL(c2.env);
  const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (rows.length === 0) {
    await sql.end();
    return c2.json({ error: "User not found" }, 404);
  }
  if (rows[0].id === adminUser.id) {
    await sql.end();
    return c2.json({ error: "Cannot deactivate yourself" }, 400);
  }
  const newActive = !rows[0].is_active;
  await sql`UPDATE users SET is_active = ${newActive} WHERE id = ${userId}`;
  await sql`INSERT INTO activity_logs (action, details, actor) VALUES ('user_toggled', ${`Admin ${adminUser.name} ${newActive ? "activated" : "deactivated"} user ${rows[0].name}`}, ${adminUser.email})`;
  await sql.end();
  return c2.json({ message: `User ${newActive ? "activated" : "deactivated"}`, is_active: newActive });
});
var admin_default = admin;

// src/routes/activity.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var activity = new Hono2();
activity.get("/", async (c2) => {
  const user = await requireAuth(c2);
  const projectId = c2.req.query("project_id");
  const limit = parseInt(c2.req.query("limit") || "50");
  const offset = parseInt(c2.req.query("offset") || "0");
  const sql = getSQL(c2.env);
  let countResult, rows;
  if (user.role === "admin") {
    if (projectId) {
      countResult = await sql`SELECT COUNT(*) as total FROM activity_logs WHERE project_id = ${parseInt(projectId)}`;
      rows = await sql`SELECT * FROM activity_logs WHERE project_id = ${parseInt(projectId)} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else {
      countResult = await sql`SELECT COUNT(*) as total FROM activity_logs`;
      rows = await sql`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    }
  } else {
    if (projectId) {
      countResult = await sql`SELECT COUNT(*) as total FROM activity_logs WHERE actor = ${user.email} AND project_id = ${parseInt(projectId)}`;
      rows = await sql`SELECT * FROM activity_logs WHERE actor = ${user.email} AND project_id = ${parseInt(projectId)} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else {
      countResult = await sql`SELECT COUNT(*) as total FROM activity_logs WHERE actor = ${user.email}`;
      rows = await sql`SELECT * FROM activity_logs WHERE actor = ${user.email} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    }
  }
  await sql.end();
  return c2.json({ logs: rows, total: parseInt(countResult[0].total), limit, offset });
});
activity.get("/summary", async (c2) => {
  const user = await requireAuth(c2);
  const sql = getSQL(c2.env);
  let total, recent, actionCounts;
  if (user.role === "admin") {
    total = await sql`SELECT COUNT(*) as count FROM activity_logs`;
    recent = await sql`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 10`;
    actionCounts = await sql`SELECT action, COUNT(*) as count FROM activity_logs GROUP BY action`;
  } else {
    total = await sql`SELECT COUNT(*) as count FROM activity_logs WHERE actor = ${user.email}`;
    recent = await sql`SELECT * FROM activity_logs WHERE actor = ${user.email} ORDER BY created_at DESC LIMIT 10`;
    actionCounts = await sql`SELECT action, COUNT(*) as count FROM activity_logs WHERE actor = ${user.email} GROUP BY action`;
  }
  await sql.end();
  const breakdown = {};
  for (const r3 of actionCounts) breakdown[r3.action] = parseInt(r3.count);
  return c2.json({ total_events: parseInt(total[0].count), recent, action_breakdown: breakdown });
});
var activity_default = activity;

// src/routes/market-intel.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var marketIntel = new Hono2();
var MARKET_PULSE = [
  { sector: "Agentic B2B", multiple: 22.4, sentiment: "Aggressive", technographic_signal: "High churn in legacy CRM; 40% migration to AI-first middleware.", hiring_surge: "DevOps/SRE hiring up 18% in mid-market SaaS.", gap_opportunity: "Unified API for autonomous agent billing." },
  { sector: "Bio-Automation", multiple: 14.1, sentiment: "Wait-and-See", technographic_signal: "Early adoption of Lab-OS standards.", hiring_surge: "Biology-specialized LLM researchers.", gap_opportunity: "Compliance-as-a-service for decentralized clinical trials." },
  { sector: "AI Infrastructure", multiple: 28.7, sentiment: "Aggressive", technographic_signal: "Enterprise GPU cluster adoption up 65% YoY.", hiring_surge: "ML Ops engineers up 32% across Fortune 500.", gap_opportunity: "Edge inference orchestration layer for real-time AI." },
  { sector: "Fintech / DeFi", multiple: 16.3, sentiment: "Cautious", technographic_signal: "Banks migrating to API-first core banking.", hiring_surge: "Compliance + crypto-native product managers.", gap_opportunity: "Regulated stablecoin treasury management API." },
  { sector: "Data / Analytics", multiple: 19.8, sentiment: "Aggressive", technographic_signal: "Data lakehouse adoption replacing legacy warehouses.", hiring_surge: "Data engineers and analytics engineers up 25%.", gap_opportunity: "Real-time data quality monitoring for AI pipelines." },
  { sector: "Cybersecurity", multiple: 24.2, sentiment: "Aggressive", technographic_signal: "Zero-trust adoption accelerating in mid-market.", hiring_surge: "AppSec and identity engineers up 40%.", gap_opportunity: "AI-powered threat detection for API-first architectures." },
  { sector: "Autonomous Robotics", multiple: 26.3, sentiment: "Aggressive", technographic_signal: "Vision-language models enabling 40%+ YoY increase in warehouse and last-mile automation pilots.", hiring_surge: "Robotics software + perception engineers up 31%.", gap_opportunity: "Unified agentic control layer for heterogeneous robot fleets." },
  { sector: "Climate Intelligence", multiple: 17.9, sentiment: "Aggressive", technographic_signal: "Post-IRA extension surge in carbon accounting and Scope 3 automation platforms.", hiring_surge: "Sustainability AI engineers up 37%.", gap_opportunity: "Real-time MRV API for enterprise net-zero compliance." },
  { sector: "Quantum Infrastructure", multiple: 12.4, sentiment: "Wait-and-See", technographic_signal: "Error-corrected logical qubits crossing 100+ threshold.", hiring_surge: "Quantum algorithm researchers up 24%.", gap_opportunity: "Cloud-accessible quantum optimization layer for supply-chain and portfolio risk modeling." }
];
var MACRO_DATA = {
  sectors: [
    { name: "AI / ML", avg_pe: 45.2, yoy_growth: 34.5, ipo_window: "Open", trend: "up" },
    { name: "SaaS", avg_pe: 32.1, yoy_growth: 18.2, ipo_window: "Selective", trend: "stable" },
    { name: "Fintech", avg_pe: 28.7, yoy_growth: 12.4, ipo_window: "Cautious", trend: "stable" },
    { name: "Blockchain", avg_pe: 38.5, yoy_growth: 28.1, ipo_window: "Opening", trend: "up" },
    { name: "Biotech", avg_pe: 22.3, yoy_growth: 8.6, ipo_window: "Selective", trend: "down" },
    { name: "Climate Tech", avg_pe: 30.4, yoy_growth: 22.3, ipo_window: "Open", trend: "up" },
    { name: "Cybersecurity", avg_pe: 41.8, yoy_growth: 25.6, ipo_window: "Open", trend: "up" },
    { name: "Semiconductors", avg_pe: 52.3, yoy_growth: 41.2, ipo_window: "Open", trend: "up" },
    { name: "Enterprise AI Software", avg_pe: 38.9, yoy_growth: 29.4, ipo_window: "Selective", trend: "up" }
  ],
  interest_rate_impact: "Moderate \u2014 rates stabilized, favoring growth equity.",
  exit_environment: "Improving. Strategic M&A picking up in AI/Infrastructure.",
  updated_at: "2026-03-27"
};
var PRIVATE_ROUNDS = [
  { company: "AgenticFlow", amount: "$12M", valuation: "$60M", sector: "Agentic B2B", stage: "Series A" },
  { company: "NeuralEdge", amount: "$8M", valuation: "$40M", sector: "AI Infrastructure", stage: "Seed" },
  { company: "DataWeave", amount: "$15M", valuation: "$75M", sector: "Data / Analytics", stage: "Series A" },
  { company: "ChainVault", amount: "$5M", valuation: "$25M", sector: "Fintech / DeFi", stage: "Seed" },
  { company: "BioScript", amount: "$20M", valuation: "$100M", sector: "Bio-Automation", stage: "Series B" },
  { company: "ShieldAI", amount: "$10M", valuation: "$50M", sector: "Cybersecurity", stage: "Series A" }
];
var STUDIO_BENCHMARKS = {
  avg_time_to_inc_days: 11,
  founder_match_rate: 88,
  api_reusability_score: 65,
  current_dry_powder: "$4.5M",
  avg_time_to_first_check_days: 28,
  conversion_idea_to_funded: 23,
  active_batch_size: 8,
  portfolio_companies: 12,
  decision_gate_pass_rate: 72,
  avg_time_to_spinout_days: 68,
  avg_founder_equity_at_spinout: 68,
  followon_funding_rate: 75,
  avg_valuation_first_round: "$9.2M",
  cost_per_spinout: "$185k",
  deployment_velocity: 35
};
marketIntel.get("/market-pulse", (c2) => c2.json({ signals: MARKET_PULSE, updated_at: (/* @__PURE__ */ new Date()).toISOString(), total_sectors: MARKET_PULSE.length }));
marketIntel.get("/macro", (c2) => c2.json(MACRO_DATA));
marketIntel.get("/private-rounds", (c2) => c2.json({ rounds: PRIVATE_ROUNDS, total: PRIVATE_ROUNDS.length, updated_at: (/* @__PURE__ */ new Date()).toISOString() }));
marketIntel.get("/studio-benchmarks", (c2) => c2.json(STUDIO_BENCHMARKS));
marketIntel.get("/competitive-intelligence", (c2) => {
  const highConviction = MARKET_PULSE.filter((s2) => s2.sentiment === "Aggressive" && s2.multiple > 15).map((s2) => {
    let playType = "Exit Play", reasoning = `Sector multiples at ${s2.multiple}x \u2014 favorable exit timing.`;
    if (s2.multiple > 20) {
      playType = "Efficiency Play";
      reasoning = `High ${s2.multiple}x multiple + aggressive sentiment = launch at 1/10th cost via studio.`;
    }
    if (s2.technographic_signal.toLowerCase().includes("churn") || s2.technographic_signal.toLowerCase().includes("migration")) {
      playType = "Replacement Play";
      reasoning = `Tech churn detected: ${s2.technographic_signal}`;
    }
    return { sector: s2.sector, play_type: playType, reasoning, gap_opportunity: s2.gap_opportunity, multiple: s2.multiple, sentiment: s2.sentiment };
  });
  return c2.json({ high_conviction_plays: highConviction, studio_benchmarks: STUDIO_BENCHMARKS, market_pulse: MARKET_PULSE, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
});
var market_intel_default = marketIntel;

// src/routes/advisory.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var advisory = new Hono2();
var TEMPLATES2 = {
  gtm: "Based on the {sector} sector, consider: 1) Product-led growth targeting early adopters, 2) Partnership-driven distribution through complementary APIs, 3) Content marketing establishing thought leadership in {sector}.",
  fundraising: "For a {stage} startup in {sector}: Target $500K-$2M at $5M-$15M pre-money. Lead with traction metrics. Use SAFE notes for speed.",
  product: "Focus on: 1) Core value proposition validation (30 days), 2) Usage analytics implementation, 3) Feature prioritization via customer feedback loops.",
  team: "Hiring priorities for {stage}: 1) Technical co-founder if missing, 2) First sales hire for B2B, 3) Product designer for B2C.",
  general: "Key strategic considerations: 1) Validate product-market fit before scaling, 2) Build measurable growth loops, 3) Maintain 18-month runway minimum."
};
advisory.post("/ask", async (c2) => {
  const user = await requireAuth(c2);
  const data = await c2.req.json();
  const sql = getSQL(c2.env);
  let project = null;
  if (data.project_id) {
    const rows = await sql`SELECT * FROM projects WHERE id = ${data.project_id}`;
    if (rows.length > 0) project = rows[0];
  }
  const sector = project?.sector || "technology";
  const stage = project?.stage || "early-stage";
  const template = TEMPLATES2[data.category] || TEMPLATES2.general;
  const advice = template.replace(/\{sector\}/g, sector).replace(/\{stage\}/g, stage);
  await sql`INSERT INTO activity_logs (project_id, action, details, actor) VALUES (${data.project_id || null}, 'ai_advisory_query', ${`Category: ${data.category} | Q: ${(data.question || "").slice(0, 100)}`}, 'ai_advisor')`;
  await sql.end();
  return c2.json({ ai_generated: false, fallback_reason: "Template-based advisory", category: data.category, advice, project_name: project?.name || null });
});
advisory.post("/financial-plan", async (c2) => {
  const user = await requireAuth(c2);
  const req = await c2.req.json();
  const sql = getSQL(c2.env);
  let project = null;
  if (req.project_id) {
    const rows = await sql`SELECT * FROM projects WHERE id = ${req.project_id}`;
    if (rows.length > 0) project = rows[0];
  }
  const monthlyBurn = req.monthly_burn || (req.team_size || 1) * (req.avg_salary || 8e4) / 12 + 5e3;
  const totalMonthlyCost = monthlyBurn + (req.planned_hires || 0) * (req.avg_salary || 8e4) / 12;
  const netBurn = totalMonthlyCost - (req.revenue_monthly || 0);
  const runway = netBurn > 0 ? (req.current_cash || 0) / netBurn : 999;
  const projections = [];
  let cash = req.current_cash || 0;
  let rev = req.revenue_monthly || 0;
  for (let m = 1; m <= 18; m++) {
    rev = rev > 0 ? rev * (1 + (req.revenue_growth_pct || 0) / 100) : 0;
    const hireCost = m > 3 && (req.planned_hires || 0) > 0 ? (req.planned_hires || 0) * (req.avg_salary || 8e4) / 12 * Math.min(m / 6, 1) : 0;
    const expenses = monthlyBurn + hireCost;
    cash = cash + rev - expenses;
    projections.push({ month: m, revenue: Math.round(rev * 100) / 100, expenses: Math.round(expenses * 100) / 100, net: Math.round((rev - expenses) * 100) / 100, cash_balance: Math.round(cash * 100) / 100 });
  }
  const breakeven = projections.find((p) => p.net >= 0)?.month || null;
  const recommendations = [];
  if (runway < 6) recommendations.push("URGENT: Runway under 6 months. Begin fundraising immediately.");
  else if (runway < 12) recommendations.push("Start fundraising within 2-3 months.");
  if ((req.revenue_monthly || 0) === 0) recommendations.push("Prioritize first revenue within 90 days.");
  if ((req.team_size || 1) > 3 && (req.revenue_monthly || 0) < monthlyBurn * 0.2) recommendations.push("Team size may be ahead of revenue.");
  if (req.project_id) {
    await sql`INSERT INTO activity_logs (project_id, action, details, actor) VALUES (${req.project_id}, 'financial_plan_generated', ${`Runway: ${runway.toFixed(1)}mo, Burn: $${Math.round(netBurn)}/mo`}, 'financial_planner')`;
  }
  await sql.end();
  return c2.json({
    summary: { monthly_burn: Math.round(monthlyBurn * 100) / 100, total_monthly_cost: Math.round(totalMonthlyCost * 100) / 100, net_monthly_burn: Math.round(netBurn * 100) / 100, runway_months: Math.round(runway * 10) / 10, runway_status: runway > 12 ? "Healthy" : runway > 6 ? "Warning" : "Critical", breakeven_month: breakeven },
    projections,
    recommendations,
    project_name: project?.name || null
  });
});
advisory.post("/diligence", async (c2) => {
  const user = await requireAuth(c2);
  const { project_id } = await c2.req.json();
  const sql = getSQL(c2.env);
  const projects2 = await sql`SELECT * FROM projects WHERE id = ${project_id}`;
  if (projects2.length === 0) {
    await sql.end();
    return c2.json({ error: "Project not found" }, 404);
  }
  const project = projects2[0];
  const scores = await sql`SELECT * FROM score_snapshots WHERE project_id = ${project_id} ORDER BY created_at DESC`;
  const docs = await sql`SELECT * FROM documents WHERE project_id = ${project_id}`;
  let founder = null;
  if (project.founder_id) {
    const f = await sql`SELECT * FROM founders WHERE id = ${project.founder_id}`;
    if (f.length > 0) founder = f[0];
  }
  const checks = [];
  let overallStatus = "pass";
  if (scores.length > 0) {
    checks.push({ category: "Scoring", item: "Startup Score", status: scores[0].total_score >= 70 ? "pass" : "fail", detail: `Score: ${scores[0].total_score}/100 (${scores[0].tier})` });
  } else {
    checks.push({ category: "Scoring", item: "Startup Score", status: "missing", detail: "No score on file." });
    overallStatus = "incomplete";
  }
  const docTypes = docs.map((d2) => d2.doc_type);
  checks.push({ category: "Legal", item: "Corporate Bylaws", status: docTypes.includes("bylaws") ? "pass" : "missing", detail: docTypes.includes("bylaws") ? "On file" : "Missing" });
  checks.push({ category: "Legal", item: "Equity Split", status: docTypes.includes("equity_split") ? "pass" : "missing", detail: docTypes.includes("equity_split") ? "On file" : "Missing" });
  checks.push({ category: "Legal", item: "Incorporation", status: project.entity_id ? "pass" : "missing", detail: project.entity_id ? "Incorporated" : "Not yet incorporated" });
  if (!project.entity_id) overallStatus = "incomplete";
  if (founder) {
    checks.push({ category: "Team", item: "Founder Profile", status: "pass", detail: `${founder.name} \u2014 ${founder.domain_expertise || "N/A"}, ${founder.experience_years}yr exp.` });
    if (founder.experience_years < 2) checks.push({ category: "Team", item: "Founder Experience", status: "warning", detail: "Low experience." });
  } else {
    checks.push({ category: "Team", item: "Founder Profile", status: "missing", detail: "No founder on record." });
    overallStatus = "incomplete";
  }
  if (project.tam && project.tam > 1e8) checks.push({ category: "Financial", item: "Market Size", status: "pass", detail: `TAM: $${project.tam.toLocaleString()}` });
  else checks.push({ category: "Financial", item: "Market Size", status: project.tam ? "warning" : "missing", detail: project.tam ? `TAM: $${project.tam.toLocaleString()} \u2014 may be small` : "TAM not specified" });
  const missing = checks.filter((c3) => c3.status === "missing").length;
  const warnings = checks.filter((c3) => c3.status === "warning").length;
  const pass = checks.filter((c3) => c3.status === "pass").length;
  if (missing > 2) overallStatus = "incomplete";
  else if (warnings > 2) overallStatus = "conditional";
  await sql`INSERT INTO activity_logs (project_id, action, details, actor) VALUES (${project_id}, 'diligence_check', ${`Result: ${overallStatus} | Pass: ${pass}, Warning: ${warnings}, Missing: ${missing}`}, 'diligence_engine')`;
  await sql.end();
  return c2.json({
    project_id,
    project_name: project.name,
    overall_status: overallStatus,
    summary: { pass, warning: warnings, missing, total: checks.length },
    checks,
    recommendation: overallStatus === "pass" ? "Ready for spinout" : overallStatus === "incomplete" ? "Address missing items" : "Conditional \u2014 review warnings",
    generated_at: (/* @__PURE__ */ new Date()).toISOString()
  });
});
var advisory_default = advisory;

// src/routes/private-data.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var privateData = new Hono2();
privateData.get("/profile", async (c2) => {
  const user = await requireAuth(c2);
  const sql = getSQL(c2.env);
  const result = { id: user.id, uid: user.uid, email: user.email, name: user.name, role: user.role, is_active: user.is_active, email_verified: user.email_verified, created_at: user.created_at };
  if (user.founder_id) {
    const f = await sql`SELECT * FROM founders WHERE id = ${user.founder_id}`;
    if (f.length > 0) result.founder_profile = f[0];
  }
  if (user.partner_id) {
    const p = await sql`SELECT * FROM partners WHERE id = ${user.partner_id}`;
    if (p.length > 0) result.partner_profile = p[0];
  }
  await sql.end();
  return c2.json(result);
});
privateData.get("/market/private-signals", async (c2) => {
  const user = await requireAuth(c2);
  if (user.role !== "admin" && user.role !== "partner") return c2.json({ error: "Insufficient permissions" }, 403);
  const signals = MARKET_PULSE.map((s2) => {
    let conviction = "neutral";
    if (s2.sentiment === "Aggressive" && s2.multiple > 20) conviction = "aggressive";
    else if (s2.sentiment === "Wait-and-See" || s2.multiple < 15) conviction = "wait-and-see";
    return { sector: s2.sector, revenue_multiple: s2.multiple, sentiment: s2.sentiment, conviction, hiring_signal: s2.hiring_surge, technographic_signal: s2.technographic_signal, gap_opportunity: s2.gap_opportunity };
  });
  const aggressive = signals.filter((s2) => s2.conviction === "aggressive").length;
  const cautious = signals.filter((s2) => s2.conviction === "wait-and-see").length;
  return c2.json({ global_conviction: aggressive > cautious ? "Aggressive" : "Wait-and-See", signals, studio_benchmarks: STUDIO_BENCHMARKS, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
});
privateData.get("/portfolio/metrics", async (c2) => {
  const user = await requireAuth(c2);
  const sql = getSQL(c2.env);
  if (user.role === "founder") {
    const projects2 = user.founder_id ? await sql`SELECT p.*, (SELECT total_score FROM score_snapshots WHERE project_id = p.id ORDER BY created_at DESC LIMIT 1) as total_score, (SELECT tier FROM score_snapshots WHERE project_id = p.id ORDER BY created_at DESC LIMIT 1) as tier FROM projects p WHERE p.founder_id = ${user.founder_id}` : [];
    await sql.end();
    return c2.json({ role: "founder", projects: projects2, total_projects: projects2.length });
  }
  if (user.role === "partner") {
    const deals2 = user.partner_id ? await sql`SELECT d.*, p.name as project_name, p.sector FROM deals d LEFT JOIN projects p ON d.project_id = p.id WHERE d.partner_id = ${user.partner_id} ORDER BY d.created_at DESC` : [];
    const committed2 = await sql`SELECT COALESCE(SUM(committed_capital), 0) as total FROM lp_investors`;
    const called2 = await sql`SELECT COALESCE(SUM(called_capital), 0) as total FROM lp_investors`;
    const portfolio = await sql`SELECT * FROM projects WHERE status IN ('spinout', 'active', 'tier_1', 'tier_2')`;
    await sql.end();
    const tvpi = Number(called2[0].total) > 0 ? Math.round(Number(committed2[0].total) / Number(called2[0].total) * 100) / 100 : 0;
    return c2.json({ role: "partner", deals: deals2, total_deals: deals2.length, active_deals: deals2.filter((d2) => ["applied", "scored", "active"].includes(d2.status)).length, fund_metrics: { total_committed: Number(committed2[0].total), total_called: Number(called2[0].total), tvpi, portfolio_companies: portfolio.length }, portfolio });
  }
  const allProjects = await sql`SELECT * FROM projects`;
  const active = allProjects.filter((p) => ["spinout", "active", "tier_1", "tier_2"].includes(p.status));
  const committed = await sql`SELECT COALESCE(SUM(committed_capital), 0) as total FROM lp_investors`;
  const called = await sql`SELECT COALESCE(SUM(called_capital), 0) as total FROM lp_investors`;
  const totalDeals = await sql`SELECT COUNT(*) as count FROM deals`;
  const activeDeals = await sql`SELECT COUNT(*) as count FROM deals WHERE status IN ('applied', 'scored', 'active')`;
  await sql.end();
  return c2.json({ role: "admin", overview: { total_projects: allProjects.length, active_projects: active.length, total_deals: Number(totalDeals[0].count), active_deals: Number(activeDeals[0].count), total_committed: Number(committed[0].total), total_called: Number(called[0].total) }, portfolio: active });
});
privateData.get("/founder/:userId", async (c2) => {
  const user = await requireAuth(c2);
  const userId = parseInt(c2.req.param("userId"));
  if (user.role !== "admin" && user.id !== userId) return c2.json({ error: "Access denied" }, 403);
  const sql = getSQL(c2.env);
  const target = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (target.length === 0 || target[0].role !== "founder") {
    await sql.end();
    return c2.json({ error: "Founder not found" }, 404);
  }
  const projects2 = target[0].founder_id ? await sql`SELECT * FROM projects WHERE founder_id = ${target[0].founder_id}` : [];
  await sql.end();
  return c2.json({ role: "founder", projects: projects2, total_projects: projects2.length });
});
var private_data_default = privateData;

// src/index.ts
var app = new Hono2();
app.use("*", cors({
  origin: ["https://axal.vc", "https://www.axal.vc", "https://studioos.guillaumelauzier.workers.dev"],
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"]
}));
app.use("*", async (c2, next) => {
  try {
    await next();
  } catch (err) {
    if (err.message === "Unauthorized") return c2.json({ detail: "Not authenticated" }, 401);
    if (err.message === "Admin required") return c2.json({ detail: "Admin access required" }, 403);
    console.error("Unhandled error:", err);
    return c2.json({ detail: "Internal server error" }, 500);
  }
});
app.get("/api/health", (c2) => c2.json({ status: "ok", app: "StudioOS v1.0", tagline: "The 30-Day Spin-Out Engine", runtime: "Cloudflare Workers" }));
app.get("/api/dashboard/stats", async (c2) => {
  const user = await requireAuth(c2);
  const sql = getSQL(c2.env);
  const totalProjects = await sql`SELECT COUNT(*) as count FROM projects`;
  const activeProjects = await sql`SELECT COUNT(*) as count FROM projects WHERE status IN ('tier_1', 'tier_2', 'spinout', 'active')`;
  const pendingScoring = await sql`SELECT COUNT(*) as count FROM projects WHERE status IN ('intake', 'scoring')`;
  const totalPartners = await sql`SELECT COUNT(*) as count FROM partners`;
  const totalInvestors = await sql`SELECT COUNT(*) as count FROM lp_investors`;
  const openTickets = await sql`SELECT COUNT(*) as count FROM tickets WHERE status IN ('open', 'in_progress')`;
  const totalDocuments = await sql`SELECT COUNT(*) as count FROM documents`;
  const avgScore = await sql`SELECT AVG(total_score) as avg FROM score_snapshots`;
  const totalDeals = await sql`SELECT COUNT(*) as count FROM deals`;
  const activeDeals = await sql`SELECT COUNT(*) as count FROM deals WHERE status IN ('applied', 'scored', 'active')`;
  const totalUsers = await sql`SELECT COUNT(*) as count FROM users`;
  await sql.end();
  return c2.json({
    total_projects: parseInt(totalProjects[0].count),
    active_projects: parseInt(activeProjects[0].count),
    pending_scoring: parseInt(pendingScoring[0].count),
    total_partners: parseInt(totalPartners[0].count),
    total_investors: parseInt(totalInvestors[0].count),
    open_tickets: parseInt(openTickets[0].count),
    total_documents: parseInt(totalDocuments[0].count),
    avg_score: avgScore[0].avg ? Math.round(parseFloat(avgScore[0].avg) * 10) / 10 : null,
    total_deals: parseInt(totalDeals[0].count),
    active_deals: parseInt(activeDeals[0].count),
    total_users: parseInt(totalUsers[0].count)
  });
});
app.route("/api/auth", auth_default);
app.route("/api/scoring", scoring_default);
app.route("/api/projects", projects_default);
app.route("/api/legal", legal_default);
app.route("/api/partners", partners_default);
app.route("/api/capital", capital_default);
app.route("/api/deals", deals_default);
app.route("/api/tickets", tickets_default);
app.route("/api/users", users_default);
app.route("/api/admin", admin_default);
app.route("/api/activity", activity_default);
app.route("/api/market-intel", market_intel_default);
app.route("/api/advisory", advisory_default);
app.route("/api/private-data", private_data_default);
var src_default = app;

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var drainBody = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } catch (e) {
    const error3 = reduceError(e);
    return Response.json(error3, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-SKjzej/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
init_modules_watch_stub();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env2, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env2, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env2, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env2, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-SKjzej/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env2, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env2, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env2, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env2, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env2, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env2, ctx) => {
      this.env = env2;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
/*! Bundled license information:

otpauth/dist/otpauth.esm.js:
  (*! otpauth 9.5.0 | (c) Héctor Molinero Fernández | MIT | https://github.com/hectorm/otpauth *)
  (*! noble-hashes 2.0.1 | (c) Paul Miller | MIT | https://github.com/paulmillr/noble-hashes *)
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
//# sourceMappingURL=index.js.map
