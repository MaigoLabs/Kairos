import type { util as zUtil } from 'zod';
import { z } from 'zod';

export const zCoerceNumber = (data: unknown) => z.coerce.number().parse(data);
export const zCoerceString = (data: unknown) => z.coerce.string().parse(data);
export const zParseEnum = <T extends zUtil.EnumLike>(enumType: T, data: unknown) => z.enum(enumType).parse(data);
