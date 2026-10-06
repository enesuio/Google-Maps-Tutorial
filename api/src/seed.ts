import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { dateSchema } from './dates.js';
import type { Db } from './db.js';

// Works from both src/ (tsx) and dist/ (compiled): seed/ is a sibling of each.
export const SEED_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../seed/seed.json');

const goalSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['bool', 'number']),
  unit: z.string().nullable().default(null),
  direction: z.enum(['at_least', 'at_most']).nullable().default(null),
  dailyTarget: z.number().nullable().default(null),
  weeklyTarget: z.number().nullable().default(null),
  sort: z.number().int().default(0),
  active: z.boolean().default(true),
});

export const seedSchema = z.object({
  challenge: z.object({
    name: z.string().min(1),
    startDate: dateSchema,
    lengthDays: z.number().int().positive(),
  }),
  users: z.array(
    z.object({
      slug: z.string().min(1),
      name: z.string().min(1),
      kcalTarget: z.number().int().nullable().default(null),
      proteinTargetG: z.number().int().nullable().default(null),
      goals: z.array(goalSchema).default([]),
    }),
  ),
});

export type SeedData = z.infer<typeof seedSchema>;
export type SeedInput = z.input<typeof seedSchema>;

export async function loadSeedFile(file: string = SEED_PATH): Promise<SeedData> {
  const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
  return seedSchema.parse(raw);
}

/**
 * Idempotent seed: challenge upserted by name, users by slug, goals by (user, key).
 * Running it twice changes nothing.
 */
export async function runSeed(db: Db, input?: SeedInput): Promise<void> {
  const data = input ? seedSchema.parse(input) : await loadSeedFile();

  await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('challenges')
      .select('id')
      .where('name', '=', data.challenge.name)
      .executeTakeFirst();
    if (existing) {
      await trx
        .updateTable('challenges')
        .set({ start_date: data.challenge.startDate, length_days: data.challenge.lengthDays })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await trx
        .insertInto('challenges')
        .values({
          name: data.challenge.name,
          start_date: data.challenge.startDate,
          length_days: data.challenge.lengthDays,
        })
        .execute();
    }

    for (const user of data.users) {
      const row = await trx
        .insertInto('users')
        .values({
          slug: user.slug,
          name: user.name,
          kcal_target: user.kcalTarget,
          protein_target_g: user.proteinTargetG,
        })
        .onConflict((oc) =>
          oc.column('slug').doUpdateSet({
            name: user.name,
            kcal_target: user.kcalTarget,
            protein_target_g: user.proteinTargetG,
          }),
        )
        .returning('id')
        .executeTakeFirstOrThrow();

      for (const goal of user.goals) {
        const values = {
          label: goal.label,
          kind: goal.kind,
          unit: goal.unit,
          direction: goal.direction,
          daily_target: goal.dailyTarget,
          weekly_target: goal.weeklyTarget,
          sort: goal.sort,
          active: goal.active,
        };
        await trx
          .insertInto('goals')
          .values({ user_id: row.id, key: goal.key, ...values })
          .onConflict((oc) => oc.columns(['user_id', 'key']).doUpdateSet(values))
          .execute();
      }
    }
  });
}
