interface MemoizeArgs {
	expiring?: number;
	hashFunction?: boolean | ((...args: any[]) => any);
	tags?: string[];
}

interface CacheValue {
	resultsMap: Map<any,any>;
	tagVersions?: Record<string, symbol>;
}

export function Memoize(args?: MemoizeArgs | MemoizeArgs['hashFunction']) {
	let hashFunction: MemoizeArgs['hashFunction'];
	let duration: MemoizeArgs['expiring'];
	let tags: MemoizeArgs['tags'];

	if (typeof args === 'object') {
		hashFunction = args.hashFunction;
		duration = args.expiring;
		tags = args.tags;
	} else {
		hashFunction = args;
	}

	return (target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<any>) => {
		if (descriptor.value != null) {
			descriptor.value = getNewFunction(descriptor.value, hashFunction, duration, tags);
		} else if (descriptor.get != null) {
			descriptor.get = getNewFunction(descriptor.get, hashFunction, duration, tags);
		} else {
			throw 'Only put a Memoize() decorator on a method or get accessor.';
		}
	};
}

export function MemoizeExpiring(expiring: number, hashFunction?: MemoizeArgs['hashFunction']) {
	return Memoize({
		expiring,
		hashFunction
	});
}

const latestTagVersions: Map<string, symbol> = new Map();

export function clear (tags: string[]): void {
	for (const tag of tags) {
		if (latestTagVersions.has(tag)) {
			latestTagVersions.set(tag, Symbol());
		}
	}
}

function getLatestTagVersionsForTags (tags: string[]) {
	return tags.reduce<Record<string, symbol>>((acc, tag) => {
		if (!latestTagVersions.has(tag)) {
			const symbolForTag = Symbol();
			latestTagVersions.set(tag, symbolForTag);
			return Object.assign(acc, { [tag]: symbolForTag });
		}
		return Object.assign(acc, { [tag]: latestTagVersions.get(tag) });
	}, {});
}

function getNewFunction(originalMethod: () => void, hashFunction?: MemoizeArgs['hashFunction'], duration: number = 0, tags?: MemoizeArgs['tags']) {
	const propMapName = Symbol(`__cache__`);

	// The function returned here gets called instead of originalMethod.
	return function (...args: any[]) {
		let returnedValue: any;

		// Get or create map
		if (!this.hasOwnProperty(propMapName)) {
			const value: CacheValue = { resultsMap: new Map<any, any>() };
			if (Array.isArray(tags)) {
				value.tagVersions = getLatestTagVersionsForTags(tags);
			}
			Object.defineProperty(this, propMapName, {
				configurable: false,
				enumerable: false,
				writable: false,
				value,
			});
		}

		const cache = this[propMapName] as CacheValue;
		let myMap: Map<any, any> = cache.resultsMap;

		if (Array.isArray(tags)) {
			const tagVersions = this[propMapName].tagVersions;
			const isAtLeastOneTagStale = tags.some((tag) => tagVersions[tag] !== latestTagVersions.get(tag));
			if (isAtLeastOneTagStale) {
				myMap.clear();
				cache.tagVersions = getLatestTagVersionsForTags(tags);
			}

		}

		if (hashFunction || args.length > 0 || duration > 0) {
			let hashKey: any;

			// If true is passed as first parameter, will automatically use every argument, passed to string
			if (hashFunction === true) {
				hashKey = args.map(a => a.toString()).join('!');
			} else if (hashFunction) {
				hashKey = hashFunction.apply(this, args);
			} else {
				hashKey = args[0];
			}

			const timestampKey = `${hashKey}__timestamp`;
			let isExpired: boolean = false;
			if (duration > 0) {
				if (!myMap.has(timestampKey)) {
					// "Expired" since it was never called before
					isExpired = true;
				} else {
					let timestamp = myMap.get(timestampKey);
					isExpired = (Date.now() - timestamp) > duration;
				}
			}

			if (myMap.has(hashKey) && !isExpired) {
				returnedValue = myMap.get(hashKey);
			} else {
				returnedValue = originalMethod.apply(this, args);
				myMap.set(hashKey, returnedValue);
				if (duration > 0) {
					myMap.set(timestampKey, Date.now());
				}
			}

		} else {
			const hashKey = this;
			if (myMap.has(hashKey)) {
				returnedValue = myMap.get(hashKey);
			} else {
				returnedValue = originalMethod.apply(this, args);
				myMap.set(hashKey, returnedValue);
			}
		}

		return returnedValue;
	};
}
