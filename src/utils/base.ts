export const objectEntries = <T extends object>(obj: T) => Object.entries(obj) as Array<[keyof T, T[keyof T]]>;

export const objectFromEntries = <T extends [string | number | symbol, unknown][]>(entries: T) => Object.fromEntries(entries) as Record<T[number][0], T[number][1]>;

export const objectKeys = <T extends object>(obj: T) => Object.keys(obj) as (keyof T)[];

export const objectMap = <T extends object, R>(obj: T, fn: (value: T[keyof T], key: keyof T) => R) =>
  Object.fromEntries(objectEntries(obj).map(([key, value]) => [key, fn(value, key)])) as Record<keyof T, R>;

export const arrayToObject = <T extends string | number | symbol, R>(array: readonly T[], fn: (value: T, index: number) => R) =>
  Object.fromEntries(array.map((value, index) => [value, fn(value, index)])) as Record<T, R>;

export const objectFilter = <T extends object>(obj: T, fn: (value: T[keyof T], key: keyof T) => boolean) =>
  Object.fromEntries(objectEntries(obj).filter(([key, value]) => fn(value, key))) as T;

export const getOrSet = <M extends Map<unknown, unknown>>(
  map: M,
  key: Parameters<M['has']>[0],
  value: Parameters<M['set']>[1],
): Parameters<M['set']>[1] => {
  if (!map.has(key)) {
    map.set(key, value);
  }
  return map.get(key)!;
};

export async function forEachParallel<T>(
  iterable: AsyncIterable<T> | Promise<Iterable<T>>,
  callback: (value: T) => Promise<void>,
) {
  const promises: Promise<void>[] = [];
  for await (const value of await iterable) {
    promises.push(callback(value));
  }
  await Promise.all(promises);
}
