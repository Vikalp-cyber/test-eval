import { z } from "zod";

export const VitalsSchema = z.object({
  bp: z.string().nullable(),
  hr: z.number().int().min(20).max(250).nullable(),
  temp_f: z.number().min(90).max(110).nullable(),
  spo2: z.number().int().min(50).max(100).nullable(),
});

export const MedicationSchema = z.object({
  name: z.string().min(1),
  dose: z.string().nullable(),
  frequency: z.string().nullable(),
  route: z.string().nullable(),
});

export const DiagnosisSchema = z.object({
  description: z.string().min(1),
  icd10: z.string().optional(),
});

export const FollowUpSchema = z.object({
  interval_days: z.number().int().min(0).max(730).nullable(),
  reason: z.string().nullable(),
});

export const ExtractionSchema = z.object({
  chief_complaint: z.string().min(1),
  vitals: VitalsSchema,
  medications: z.array(MedicationSchema),
  diagnoses: z.array(DiagnosisSchema),
  plan: z.array(z.string().min(1)),
  follow_up: FollowUpSchema,
});

export type Vitals = z.infer<typeof VitalsSchema>;
export type Medication = z.infer<typeof MedicationSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type FollowUp = z.infer<typeof FollowUpSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;

export const RunRequestSchema = z.object({
  strategy: z.enum(["zero_shot", "few_shot", "cot"]),
  model: z.string().default("claude-haiku-4-5-20251001"),
  dataset_filter: z.string().optional(), // optional prefix to filter cases
});

export type RunRequest = z.infer<typeof RunRequestSchema>;
