import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { ZodObject, type z } from 'zod';

/**
 * Validates a request payload against a shared zod schema (from
 * `@fotoproy/shared`) and returns the parsed, typed value.
 *
 * Request bodies are validated in **strict** mode: an unknown field is a client
 * bug or an attempt to smuggle data past the contract, so it is rejected instead
 * of silently dropped. Queries and params stay permissive on purpose — clients
 * add cache busters and other parameters the schema does not model — while the
 * fields the schema declares are still validated.
 */
@Injectable()
export class ZodValidationPipe<T extends z.ZodTypeAny> implements PipeTransform<
  unknown,
  z.infer<T>
> {
  constructor(private readonly schema: T) {}

  transform(value: unknown, metadata?: ArgumentMetadata): z.infer<T> {
    const strict = metadata?.type === 'body' && this.schema instanceof ZodObject;
    const schema = strict ? (this.schema as ZodObject).strict() : this.schema;
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues,
      });
    }
    return result.data as z.infer<T>;
  }
}
