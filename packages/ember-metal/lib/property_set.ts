import { assert, deprecate } from '@ember/debug';
import { PROPERTY_BASED_DESCRIPTORS } from '@ember/deprecated-features';
import EmberError from '@ember/error';
import { DEBUG } from '@glimmer/env';
import { descriptorFor, isDescriptor, Meta, meta, peekMeta } from 'ember-meta';
import { HAS_NATIVE_PROXY, toString } from 'ember-utils';
import { isPath } from './path_cache';
import { Descriptor, MandatorySetterFunction } from './properties';
import { notifyPropertyChange } from './property_events';
import { _getPath as getPath, getPossibleMandatoryProxyValue } from './property_get';

interface ExtendedObject {
  isDestroyed?: boolean;
  setUnknownProperty?: (keyName: string, value: any) => any;
}

let setWithMandatorySetter: <T extends object, K extends keyof T>(
  meta: Meta,
  obj: T,
  keyName: K,
  value: T[K]
) => void;
let makeEnumerable: (obj: object, keyName: string) => void;

/**
 @module @ember/object
*/
/**
  Sets the value of a property on an object, respecting computed properties
  and notifying observers and other listeners of the change.
  If the specified property is not defined on the object and the object
  implements the `setUnknownProperty` method, then instead of setting the
  value of the property on the object, its `setUnknownProperty` handler
  will be invoked with the two parameters `keyName` and `value`.

  ```javascript
  import { set } from '@ember/object';
  set(obj, "name", value);
  ```

  @method set
  @static
  @for @ember/object
  @param {Object} obj The object to modify.
  @param {String} keyName The property key to set
  @param {Object} value The value to set
  @return {Object} the passed value.
  @public
*/
export function set(obj: object, keyName: string, value: any, tolerant?: boolean): any | void {
  assert(
    `Set must be called with three or four arguments; an object, a property key, a value and tolerant true/false`,
    arguments.length === 3 || arguments.length === 4
  );
  assert(
    `Cannot call set with '${keyName}' on an undefined object.`,
    (obj && typeof obj === 'object') || typeof obj === 'function'
  );
  assert(
    `The key provided to set must be a string or number, you passed ${keyName}`,
    typeof keyName === 'string' || (typeof keyName === 'number' && !isNaN(keyName))
  );
  assert(
    `'this' in paths is not supported`,
    typeof keyName !== 'string' || keyName.lastIndexOf('this.', 0) !== 0
  );

  if ((obj as ExtendedObject).isDestroyed) {
    assert(
      `calling set on destroyed object: ${toString(obj)}.${keyName} = ${toString(value)}`,
      tolerant
    );
    return;
  }

  if (isPath(keyName)) {
    return setPath(obj, keyName, value, tolerant);
  }

  let possibleDesc = descriptorFor(obj, keyName);

  if (possibleDesc !== undefined) {
    /* computed property */
    possibleDesc.set(obj, keyName, value);
    return value;
  }

  let currentValue: any;
  if (DEBUG && HAS_NATIVE_PROXY) {
    currentValue = getPossibleMandatoryProxyValue(obj, keyName);
  } else {
    currentValue = obj[keyName];
  }

  if (PROPERTY_BASED_DESCRIPTORS && isDescriptor(currentValue)) {
    deprecate(
      `[DEPRECATED] computed property '${keyName}' was not set on object '${toString(
        obj
      )}' via 'defineProperty'`,
      false,
      {
        id: 'ember-meta.descriptor-on-object',
        until: '3.5.0',
        url:
          'https://emberjs.com/deprecations/v3.x#toc_use-defineProperty-to-define-computed-properties',
      }
    );

    let cv: Descriptor = currentValue;

    Object.defineProperty(obj, keyName, {
      configurable: true,
      enumerable: cv.enumerable === false,
      get() {
        return cv.get(this, keyName);
      },
    });

    meta(obj).writeDescriptors(keyName, cv);

    if (typeof cv.setup === 'function') {
      cv.setup(obj, keyName);
    }

    cv.set(obj, keyName, value);
    return value;
  }

  if (
    currentValue === undefined &&
    'object' === typeof obj &&
    !(keyName in obj) &&
    typeof (obj as ExtendedObject).setUnknownProperty === 'function'
  ) {
    /* unknown property */
    (obj as ExtendedObject).setUnknownProperty!(keyName, value);
  } else {
    let meta = peekMeta(obj);

    if (DEBUG) {
      setWithMandatorySetter<any, any>(meta, obj, keyName, value);
    } else {
      obj[keyName] = value;
    }

    if (currentValue !== value) {
      notifyPropertyChange(obj, keyName, meta);
    }
  }

  return value;
}

if (DEBUG) {
  setWithMandatorySetter = (meta, obj, keyName, value) => {
    if (meta !== undefined && meta.peekWatching(keyName) > 0) {
      makeEnumerable(obj, keyName);
      meta.writeValue(obj, keyName, value);
    } else {
      obj[keyName] = value;
    }
  };

  makeEnumerable = (obj: object, key: string) => {
    let desc = Object.getOwnPropertyDescriptor(obj, key);

    if (desc && desc.set && (desc.set as MandatorySetterFunction).isMandatorySetter) {
      desc.enumerable = true;
      Object.defineProperty(obj, key, desc);
    }
  };
}

function setPath(root: object, path: string, value: any, tolerant?: boolean): any {
  let parts = path.split('.');
  let keyName = parts.pop() as string;

  assert('Property set failed: You passed an empty path', keyName!.trim().length > 0);

  let newPath = parts.join('.');
  let newRoot = getPath(root, newPath);

  if (newRoot !== null && newRoot !== undefined) {
    return set(newRoot, keyName, value);
  } else if (!tolerant) {
    throw new EmberError(`Property set failed: object in path "${newPath}" could not be found.`);
  }
}

/**
  Error-tolerant form of `set`. Will not blow up if any part of the
  chain is `undefined`, `null`, or destroyed.

  This is primarily used when syncing bindings, which may try to update after
  an object has been destroyed.

  ```javascript
  import { trySet } from '@ember/object';

  let obj = { name: "Zoey" };
  trySet(obj, "contacts.twitter", "@emberjs");
  ```

  @method trySet
  @static
  @for @ember/object
  @param {Object} root The object to modify.
  @param {String} path The property path to set
  @param {Object} value The value to set
  @public
*/
export function trySet(root: object, path: string, value: any): any {
  return set(root, path, value, true);
}
