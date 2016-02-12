import base64url from 'base64url'
import eventToPromise from 'event-to-promise'
import forEach from 'lodash.foreach'
import has from 'lodash.has'
import highland from 'highland'
import humanFormat from 'human-format'
import invert from 'lodash.invert'
import isArray from 'lodash.isarray'
import isString from 'lodash.isstring'
import kindOf from 'kindof'
import multiKeyHashInt from 'multikey-hash'
import xml2js from 'xml2js'
import { defer } from 'promise-toolbox'
import {promisify} from 'bluebird'
import {
  createHash,
  randomBytes
} from 'crypto'
import { Readable } from 'stream'
import through2 from 'through2'
import {utcFormat as d3TimeFormat} from 'd3-time-format'

// ===================================================================

export function bufferToStream (buf) {
  const stream = new Readable()

  let i = 0
  const { length } = buf
  stream._read = function (size) {
    if (i === length) {
      return this.push(null)
    }

    const newI = Math.min(i + size, length)
    this.push(buf.slice(i, newI))
    i = newI
  }

  return stream
}

// -------------------------------------------------------------------

export function camelToSnakeCase (string) {
  return string.replace(
    /([a-z])([A-Z])/g,
    (_, prevChar, currChar) => `${prevChar}_${currChar.toLowerCase()}`
  )
}

// -------------------------------------------------------------------

// Returns an empty object without prototype (if possible).
export const createRawObject = Object.create
  ? (createObject => () => createObject(null))(Object.create)
  : () => ({})

// -------------------------------------------------------------------

const ALGORITHM_TO_ID = {
  md5: '1',
  sha256: '5',
  sha512: '6'
}

const ID_TO_ALGORITHM = invert(ALGORITHM_TO_ID)

// Wrap a readable stream in a stream with a checksum promise
// attribute which is resolved at the end of an input stream.
// (Finally .checksum contains the checksum of the input stream)
//
// Example:
// const sourceStream = ...
// const targetStream = ...
// const checksumStream = addChecksumToReadStream(sourceStream)
// await Promise.all([
//   eventToPromise(checksumStream.pipe(targetStream), 'finish'),
//   checksumStream.checksum.then(console.log)
// ])
export const addChecksumToReadStream = (stream, algorithm = 'md5') => {
  const algorithmId = ALGORITHM_TO_ID[algorithm]

  if (!algorithmId) {
    throw new Error(`unknown algorithm: ${algorithm}`)
  }

  const hash = createHash(algorithm)
  const { promise, resolve } = defer()

  const wrapper = stream.pipe(through2(
    (chunk, enc, callback) => {
      hash.update(chunk)
      callback(null, chunk)
    },
    callback => {
      resolve(hash.digest('hex'))
      callback()
    }
  ))

  stream.on('error', error => wrapper.emit('error', error))
  wrapper.checksum = promise.then(hash => `$${algorithmId}$$${hash}`)

  return wrapper
}

// Check if the checksum of a readable stream is equals to an expected checksum.
// The given stream is wrapped in a stream which emits an error event
// if the computed checksum is not equals to the expected checksum.
export const validChecksumOfReadStream = (stream, expectedChecksum) => {
  const algorithmId = expectedChecksum.slice(1, expectedChecksum.indexOf('$', 1))

  if (!algorithmId) {
    throw new Error(`unknown algorithm: ${algorithmId}`)
  }

  const hash = createHash(ID_TO_ALGORITHM[algorithmId])

  const wrapper = stream.pipe(through2(
    { highWaterMark: 0 },
    (chunk, enc, callback) => {
      hash.update(chunk)
      callback(null, chunk)
    },
    callback => {
      const checksum = `$${algorithmId}$$${hash.digest('hex')}`

      callback(
        checksum !== expectedChecksum
          ? new Error(`Bad checksum (${checksum}), expected: ${expectedChecksum}`)
          : null
      )
    }
  ))

  stream.on('error', error => wrapper.emit('error', error))
  wrapper.checksumVerified = eventToPromise(wrapper, 'end')

  return wrapper
}

// -------------------------------------------------------------------

// Ensure the value is an array, wrap it if necessary.
export function ensureArray (value) {
  if (value === undefined) {
    return []
  }

  return isArray(value) ? value : [value]
}

// -------------------------------------------------------------------

// Returns the value of a property and removes it from the object.
export function extractProperty (obj, prop) {
  const value = obj[prop]
  delete obj[prop]
  return value
}

// -------------------------------------------------------------------

export const generateUnsecureToken = (n = 32) => {
  const bytes = new Buffer(n)

  const odd = n & 1
  for (let i = 0, m = n - odd; i < m; i += 2) {
    bytes.writeUInt16BE(Math.random() * 65536 | 0, i)
  }

  if (odd) {
    bytes.writeUInt8(Math.random() * 256 | 0, n - 1)
  }

  return base64url(bytes)
}

// Generate a secure random Base64 string.
export const generateToken = (function (randomBytes) {
  return (n = 32) => randomBytes(n).then(base64url)
})(promisify(randomBytes))

// -------------------------------------------------------------------

export const formatXml = (function () {
  const builder = new xml2js.Builder({
    headless: true
  })

  return (...args) => builder.buildObject(...args)
})()

export const parseXml = (function () {
  const opts = {
    mergeAttrs: true,
    explicitArray: false
  }

  return (xml) => {
    let result

    // xml2js.parseString() use a callback for synchronous code.
    xml2js.parseString(xml, opts, (error, result_) => {
      if (error) {
        throw error
      }

      result = result_
    })

    return result
  }
})()

// -------------------------------------------------------------------

// This function does nothing and returns undefined.
//
// It is often used to swallow promise's errors.
export const noop = () => {}

// -------------------------------------------------------------------

export const isPromise = value => (
  value != null &&
  typeof value.then === 'function'
)

const _pAll = (promises, mapFn) => {
  let mainPromise = Promise.resolve()

  const results = mapFn
    ? (promises = map(promises, mapFn))
    : 'length' in promises
      ? new Array(promises.length)
      : {}

  forEach(promises, (promise, key) => {
    mainPromise = mainPromise
      .then(() => promise)
      .then(value => {
        results[key] = value
      })
  })

  return mainPromise.then(() => results)
}

// Returns a promise which resolves when all the promises in a
// collection have resolved or rejects with the reason of the first
// promise that rejects.
//
// Optionally a function can be provided to map all items in the
// collection before waiting for completion.
//
// Usage: pAll(promises, [ mapFn ]) or promises::pAll([ mapFn ])
export function pAll (promises, mapFn) {
  if (this) {
    mapFn = promises
    promises = this
  }

  return Promise.resolve(promises)
    .then(promises => _pAll(promises, mapFn))
}

// Usage: pDebug(promise, name) or promise::pDebug(name)
export function pDebug (promise, name) {
  if (arguments.length === 1) {
    name = promise
    promise = this
  }

  Promise.resolve(promise).then(
    value => {
      console.log(
        '%s',
        `Promise ${name} resolved${value !== undefined ? ` with ${kindOf(value)}` : ''}`
      )
    },
    reason => {
      console.log(
        '%s',
        `Promise ${name} rejected${reason !== undefined ? ` with ${kindOf(reason)}` : ''}`
      )
    }
  )

  return promise
}

// Ponyfill for Promise.finally(cb)
//
// Usage: promise::pFinally(cb)
export function pFinally (cb) {
  return this.then(
    value => this.constructor.resolve(cb()).then(() => value),
    reason => this.constructor.resolve(cb()).then(() => {
      throw reason
    })
  )
}

// Usage:
//
//     pFromCallback(cb => fs.readFile('foo.txt', cb))
//       .then(content => {
//         console.log(content)
//       })
export const pFromCallback = fn => new Promise((resolve, reject) => {
  fn((error, result) => error
    ? reject(error)
    : resolve(result)
  )
})

const _pReflectResolution = (__proto__ => value => ({
  __proto__,
  value: () => value
}))({
  isFulfilled: () => true,
  isRejected: () => false,
  reason: () => {
    throw new Error('no reason, the promise has resolved')
  }
})

const _pReflectRejection = (__proto__ => reason => ({
  __proto__,
  reason: () => reason
}))({
  isFulfilled: () => false,
  isRejected: () => true,
  value: () => {
    throw new Error('no value, the promise has rejected')
  }
})

// Returns a promise that is always successful when this promise is
// settled. Its fulfillment value is an object that implements the
// PromiseInspection interface and reflects the resolution this
// promise.
//
// Usage: pReflect(promise) or promise::pReflect()
export function pReflect (promise) {
  return Promise.resolve(this || promise).then(
    _pReflectResolution,
    _pReflectRejection
  )
}

// Given a collection (array or object) which contains promises,
// return a promise that is fulfilled when all the items in the
// collection are either fulfilled or rejected.
//
// This promise will be fulfilled with a collection (of the same type,
// array or object) containing promise inspections.
//
// Usage: pSettle(promises) or promises::pSettle()
export function pSettle (promises) {
  return pAll(this || promises, pReflect)
}

// -------------------------------------------------------------------

export {
  // Create a function which returns promises instead of taking a
  // callback.
  promisify,

  // For all enumerable methods of an object, create a new method
  // which name is suffixed with `Async` which return promises instead
  // of taking a callback.
  promisifyAll
} from 'bluebird'

// -------------------------------------------------------------------

export function parseSize (size) {
  if (!isString(size)) {
    return size
  }

  let bytes = humanFormat.parse.raw(size, { scale: 'binary' })
  if (bytes.unit && bytes.unit !== 'B') {
    bytes = humanFormat.parse.raw(size)

    if (bytes.unit && bytes.unit !== 'B') {
      throw new Error('invalid size: ' + size)
    }
  }
  return Math.floor(bytes.value * bytes.factor)
}

// -------------------------------------------------------------------

const _has = Object.prototype.hasOwnProperty

// Removes an own property from an object and returns its value.
export const popProperty = obj => {
  for (const prop in obj) {
    if (_has.call(obj, prop)) {
      return extractProperty(obj, prop)
    }
  }
}

// -------------------------------------------------------------------

// Format a date in ISO 8601 in a safe way to be used in filenames
// (even on Windows).
export const safeDateFormat = d3TimeFormat('%Y%m%dT%H%M%SZ')

// -------------------------------------------------------------------

// This functions are often used throughout xo-server.
//
// Exports them from here to avoid direct dependencies on lodash.
export { default as forEach } from 'lodash.foreach'
export { default as isEmpty } from 'lodash.isempty'
export { default as mapToArray } from 'lodash.map'

// -------------------------------------------------------------------

// Special value which can be returned to stop an iteration in map()
// and mapInPlace().
export const DONE = {}

// Fill `target` by running each element in `collection` through
// `iteratee`.
//
// If `target` is undefined, it defaults to a new array if
// `collection` is array-like (has a `length` property), otherwise an
// object.
//
// The context of `iteratee` can be specified via `thisArg`.
//
// Note: the Mapping can be interrupted by returning the special value
// `DONE` provided as the fourth argument.
//
// Usage: map(collection, item => item + 1)
export function map (
  collection,
  iteratee,
  target = has(collection, 'length') ? [] : {}
) {
  forEach(collection, (item, i) => {
    const value = iteratee(item, i, collection, DONE)
    if (value === DONE) {
      return false
    }

    target[i] = value
  })

  return target
}

// -------------------------------------------------------------------

// Create a hash from multiple values.
export const multiKeyHash = (...args) => new Promise(resolve => {
  const hash = multiKeyHashInt(...args)

  const buf = new Buffer(4)
  buf.writeUInt32LE(hash, 0)

  resolve(base64url(buf))
})

// -------------------------------------------------------------------

export const streamToArray = (stream, filter = undefined) => new Promise((resolve, reject) => {
  stream = highland(stream).stopOnError(reject)
  if (filter) {
    stream = stream.filter(filter)
  }
  stream.toArray(resolve)
})

// -------------------------------------------------------------------

// Wrap a value in a function.
export const wrap = value => () => value
