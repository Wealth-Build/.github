import { z } from 'zod';

// =============================================================================
// Enums
// =============================================================================

// Internal dimension keys. Values from v1 rubric are kept so the v1 DB row
// remains parseable; v2 values are appended. `change_management` is defined
// but intentionally absent from all active rubric dimension_weights (ADR-006).
export const ScoringDimensionEnum = z.enum([
  // v1 dimensions
  'leadership_commitment',
  'policy_governance',
  'systems_integration',
  'technical_infrastructure',
  'data_quality',
  'process_automation',
  'staff_readiness',
  'change_management',
  // v2 dimensions (AI Readiness Assessment instrument v1.0)
  'data_readiness',
  'management_buy_in',
  'ai_problem_identification',
  'systems_thinking',
  'system_integration',
  'sop_workflow_automation',
  'current_ai_usage',
]);

export const ScoringFunctionEnum = z.enum([
  'bool_score', // Yes/No with configurable weights (default: 85 yes, 35 no)
  'scale_score', // Numeric scale converted to 0–100
  'enum_score', // Categorical values mapped to scores
  'count_score', // Count-based scoring with max threshold (reserved)
  'weighted_sum', // Weighted sub-field sum (reserved)
  'custom', // Custom scoring function (reserved)
]);

export const QuestionTypeEnum = z.enum([
  'boolean',
  'scale_1_to_5',
  'scale_0_to_4', // added for AI Readiness Assessment instrument
  'single_select',
  'multi_select',
  'free_text',
]);

export const DisplayDimensionEnum = z.enum(['leadership', 'systems', 'process', 'readiness']);

// =============================================================================
// Sub-schemas
// =============================================================================

export const ScoringConfigIdSchema = z.string().uuid();

export const ReadinessTierSchema = z.object({
  label: z.string(),
  min: z.number().int().min(0),
  max: z.number().int().max(100),
  description: z.string().optional(),
});

export const DimensionWeightConfigSchema = z.object({
  dimension: ScoringDimensionEnum,
  overall_weight: z.number().min(0).max(1),
  min_score_threshold: z.number().min(0).max(100).optional(),
  description: z.string().optional(),
});

export const ScoringWeightConfigSchema = z.object({
  question_id: z.string(),
  dimension: ScoringDimensionEnum,
  base_weight: z.number().min(0).max(1),
  scoring_function: ScoringFunctionEnum,
  question_type: QuestionTypeEnum,
  enabled: z.boolean().default(true),
  source_fields: z.array(z.string()),
  rationale_template: z.string().optional(),
  description: z.string().optional(),

  // Function-specific configuration
  bool_score_config: z
    .object({
      true_score: z.number().min(0).max(100).default(85),
      false_score: z.number().min(0).max(100).default(35),
    })
    .optional(),
  scale_score_config: z
    .object({
      min_scale: z.number(),
      max_scale: z.number(),
      linear_mapping: z.boolean().default(true),
    })
    .optional(),
  enum_score_config: z
    .object({
      value_score_mapping: z.record(z.string(), z.number().min(0).max(100)),
    })
    .optional(),
});

export const QuestionResponseSchema = z.object({
  question_id: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  score: z.number().min(0).max(100).optional(),
  rationale: z.string().optional(),
});

export const DimensionScoreSchema = z.object({
  dimension: ScoringDimensionEnum,
  display_dimension: DisplayDimensionEnum,
  raw_score: z.number().min(0).max(100),
  weighted_contribution: z.number().min(0).max(100),
  question_scores: z.array(QuestionResponseSchema),
});

export const AuditScoringResultSchema = z.object({
  composite_score: z.number().min(0).max(100),
  dimension_scores: z.array(DimensionScoreSchema),
  readiness_tier: z.string().optional(),
  passing: z.boolean(),
  scored_at: z.string().datetime(),
});

export const ScoringConfigVersionSchema = z.object({
  id: ScoringConfigIdSchema.optional(),
  version: z.string(), // Semantic versioning: "1.0.0", "2.0.0"
  name: z.string(),
  description: z.string().optional(),

  // Maps each internal ScoringDimensionEnum value to one of the 4 display dims.
  // Stored inside the rubric (not hardcoded in the API) so re-routing a dim
  // only requires a new rubric version, not a shared-package change (ADR-006).
  display_dimension_mapping: z.record(ScoringDimensionEnum, DisplayDimensionEnum),

  // Question-level scoring rules
  question_weights: z.array(ScoringWeightConfigSchema),

  // Dimension-level configuration
  dimension_weights: z.array(DimensionWeightConfigSchema),

  total_score_calculation: z.enum(['weighted_average']),
  passing_threshold: z.number().min(0).max(100),

  // Named tiers for the composite score (optional; used for display labels)
  readiness_tiers: z.array(ReadinessTierSchema).optional(),

  created_by: z.string(),
  created_at: z.string().datetime(),
  is_active: z.boolean().default(false), // Only one version can be active
  changelog: z.array(z.string()).default([]),
});

// =============================================================================
// Exported types
// =============================================================================

export type ScoringWeightConfig = z.infer<typeof ScoringWeightConfigSchema>;
export type DimensionWeightConfig = z.infer<typeof DimensionWeightConfigSchema>;
export type ScoringConfigVersion = z.infer<typeof ScoringConfigVersionSchema>;
export type QuestionResponse = z.infer<typeof QuestionResponseSchema>;
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;
export type AuditScoringResult = z.infer<typeof AuditScoringResultSchema>;
export type ReadinessTier = z.infer<typeof ReadinessTierSchema>;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Validates that dimension weights sum to 1.0 (or close to it)
 */
export const validateDimensionWeights = (weights: DimensionWeightConfig[]): boolean => {
  const sum = weights.reduce((total, weight) => total + weight.overall_weight, 0);
  return Math.abs(sum - 1.0) < 0.001; // Allow for floating point precision errors
};

// =============================================================================
// Default scoring config factory — v2.0.0
//
// Implements the AI Readiness Assessment instrument (v1.0, attached MD):
//   • 8 active internal dimensions (7 new + policy_governance retained)
//   • 46 scored question_weights on a 0–4 scale
//   • 3 roadmap-only entries (enabled: false) for multi-selects & free text
//   • dimension_weights summing to exactly 1.0
//   • display_dimension_mapping collapses 8 dims → 4 display dims
//   • readiness_tiers: Foundational / Emerging / Operational / Scaling
//
// The seven MD dimensions and policy_governance map to display dimensions as:
//   leadership  ← management_buy_in (0.15), policy_governance (0.10),
//                 ai_problem_identification (0.05)
//   systems     ← data_readiness (0.20), system_integration (0.15)
//   process     ← systems_thinking (0.12), sop_workflow_automation (0.13)
//   readiness   ← current_ai_usage (0.10)
// =============================================================================

const SCALE_0_4 = { min_scale: 0, max_scale: 4, linear_mapping: true } as const;
const EQ7 = 0.143; // equal weight for 7-question dimensions (rounds to 1.001, within tolerance)
const EQ5 = 0.2; // equal weight for 5-question dimensions
const EQ6 = 0.167; // equal weight for 6-question dimensions (rounds to 1.002, within tolerance)

export const createDefaultScoringConfig = (
  version: string = '2.0.0',
  createdBy: string = 'system',
): ScoringConfigVersion => ({
  version,
  name: 'audit_readiness',
  description: `Deterministic AI-readiness scoring rubric, v${version} (ADR-006).`,

  display_dimension_mapping: {
    // v2 active dimensions
    management_buy_in: 'leadership',
    policy_governance: 'leadership',
    ai_problem_identification: 'leadership',
    data_readiness: 'systems',
    system_integration: 'systems',
    systems_thinking: 'process',
    sop_workflow_automation: 'process',
    current_ai_usage: 'readiness',
    // v1 dimensions — mapped for backward compatibility; not active in v2 rubric
    leadership_commitment: 'leadership',
    systems_integration: 'systems',
    technical_infrastructure: 'systems',
    data_quality: 'systems',
    process_automation: 'process',
    staff_readiness: 'readiness',
    change_management: 'leadership',
  },

  question_weights: [
    // ------------------------------------------------------------------
    // Dimension 1 — Data Readiness (7 questions, equal weight)
    // ------------------------------------------------------------------
    {
      question_id: 'data_readiness.q1_1',
      dimension: 'data_readiness',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.data_readiness.q1_1'],
      description: 'Where core business data lives today.',
      rationale_template: 'Data location maturity score: {value}/4.',
    },
    {
      question_id: 'data_readiness.q1_2',
      dimension: 'data_readiness',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.data_readiness.q1_2'],
      description: 'Quality and consistency of data.',
      rationale_template: 'Data quality score: {value}/4.',
    },
    {
      question_id: 'data_readiness.q1_3',
      dimension: 'data_readiness',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.data_readiness.q1_3'],
      description: 'Ease of data access for team members.',
      rationale_template: 'Data accessibility score: {value}/4.',
    },
    {
      question_id: 'data_readiness.q1_4',
      dimension: 'data_readiness',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.data_readiness.q1_4'],
      description: 'Data documentation maturity (definitions, sources, ownership).',
      rationale_template: 'Data documentation score: {value}/4.',
    },
    {
      question_id: 'data_readiness.q1_5',
      dimension: 'data_readiness',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.data_readiness.q1_5'],
      description: 'Governance of sensitive data (PII, financial, customer).',
      rationale_template: 'Sensitive data governance score: {value}/4.',
    },
    {
      question_id: 'data_readiness.q1_6',
      dimension: 'data_readiness',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.data_readiness.q1_6'],
      description: 'Share of data that is machine-readable / structured.',
      rationale_template: 'Machine-readable data share score: {value}/4.',
    },
    {
      question_id: 'data_readiness.q1_7',
      dimension: 'data_readiness',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.data_readiness.q1_7'],
      description: 'Frequency of operational data updates.',
      rationale_template: 'Data freshness score: {value}/4.',
    },

    // ------------------------------------------------------------------
    // Dimension 2 — Management Buy-In & Budget (7 questions, equal weight)
    // ------------------------------------------------------------------
    {
      question_id: 'management_buy_in.q2_1',
      dimension: 'management_buy_in',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.management_buy_in.q2_1'],
      description: "Leadership's stance on AI adoption.",
      rationale_template: 'Leadership AI stance score: {value}/4.',
    },
    {
      question_id: 'management_buy_in.q2_2',
      dimension: 'management_buy_in',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.management_buy_in.q2_2'],
      description: 'Dedicated budget for AI initiatives.',
      rationale_template: 'AI budget allocation score: {value}/4.',
    },
    {
      question_id: 'management_buy_in.q2_3',
      dimension: 'management_buy_in',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.management_buy_in.q2_3'],
      description: 'Accountable owner / sponsor for AI efforts.',
      rationale_template: 'AI ownership clarity score: {value}/4.',
    },
    {
      question_id: 'management_buy_in.q2_4',
      dimension: 'management_buy_in',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.management_buy_in.q2_4'],
      description: 'Leadership team alignment on AI priorities.',
      rationale_template: 'Leadership alignment score: {value}/4.',
    },
    {
      question_id: 'management_buy_in.q2_5',
      dimension: 'management_buy_in',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.management_buy_in.q2_5'],
      description: "Leadership's time-to-value expectation for AI.",
      rationale_template: 'Time-to-value realism score: {value}/4.',
    },
    {
      question_id: 'management_buy_in.q2_6',
      dimension: 'management_buy_in',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.management_buy_in.q2_6'],
      description: 'Organizational change responsiveness.',
      rationale_template: 'Change adaptability score: {value}/4.',
    },
    {
      question_id: 'management_buy_in.q2_7',
      dimension: 'management_buy_in',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.management_buy_in.q2_7'],
      description: 'Definition of AI ROI / success metrics.',
      rationale_template: 'AI ROI definition score: {value}/4.',
    },

    // ------------------------------------------------------------------
    // Dimension 3 — AI Problem Identification (5 scored + 2 roadmap)
    // ------------------------------------------------------------------

    // Roadmap entry 3.1 — target efficiency problems (multi-select, unscored)
    {
      question_id: 'ai_problem_identification.q3_1',
      dimension: 'ai_problem_identification',
      base_weight: 0,
      scoring_function: 'scale_score',
      question_type: 'multi_select',
      enabled: false,
      source_fields: ['ai_readiness_assessment.ai_problem_identification.q3_1_selections'],
      description: 'Target efficiency problems (roadmap input — unscored multi-select).',
    },

    // Roadmap entry 3.2 — most painful process (free text, unscored)
    {
      question_id: 'ai_problem_identification.q3_2',
      dimension: 'ai_problem_identification',
      base_weight: 0,
      scoring_function: 'scale_score',
      question_type: 'free_text',
      enabled: false,
      source_fields: ['ai_readiness_assessment.ai_problem_identification.q3_2_text'],
      description: 'Most painful or time-consuming process (roadmap input — unscored free text).',
    },

    // Scored questions 3.3–3.7
    {
      question_id: 'ai_problem_identification.q3_3',
      dimension: 'ai_problem_identification',
      base_weight: EQ5,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.ai_problem_identification.q3_3'],
      description: 'Clarity of the specific problem to solve with AI.',
      rationale_template: 'Problem articulation clarity score: {value}/4.',
    },
    {
      question_id: 'ai_problem_identification.q3_4',
      dimension: 'ai_problem_identification',
      base_weight: EQ5,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.ai_problem_identification.q3_4'],
      description: 'Knowledge of problem cost (time, money, errors).',
      rationale_template: 'Problem cost quantification score: {value}/4.',
    },
    {
      question_id: 'ai_problem_identification.q3_5',
      dimension: 'ai_problem_identification',
      base_weight: EQ5,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.ai_problem_identification.q3_5'],
      description: 'Prioritization of which problem to tackle first.',
      rationale_template: 'Problem prioritization score: {value}/4.',
    },
    {
      question_id: 'ai_problem_identification.q3_6',
      dimension: 'ai_problem_identification',
      base_weight: EQ5,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.ai_problem_identification.q3_6'],
      description: 'Repeatability and rule-based nature of the target process.',
      rationale_template: 'Process repeatability score: {value}/4.',
    },
    {
      question_id: 'ai_problem_identification.q3_7',
      dimension: 'ai_problem_identification',
      base_weight: EQ5,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.ai_problem_identification.q3_7'],
      description: 'Current measurable performance of the target process.',
      rationale_template: 'Process performance baseline score: {value}/4.',
    },

    // ------------------------------------------------------------------
    // Dimension 4 — Systems Thinking Protocols (7 questions, equal weight)
    // ------------------------------------------------------------------
    {
      question_id: 'systems_thinking.q4_1',
      dimension: 'systems_thinking',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.systems_thinking.q4_1'],
      description: 'How the team responds to problems (reactive vs. systemic).',
      rationale_template: 'Problem response maturity score: {value}/4.',
    },
    {
      question_id: 'systems_thinking.q4_2',
      dimension: 'systems_thinking',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.systems_thinking.q4_2'],
      description: 'Cross-departmental workflow visibility.',
      rationale_template: 'Cross-functional visibility score: {value}/4.',
    },
    {
      question_id: 'systems_thinking.q4_3',
      dimension: 'systems_thinking',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.systems_thinking.q4_3'],
      description: 'Consideration of downstream impacts before changing a process.',
      rationale_template: 'Downstream impact awareness score: {value}/4.',
    },
    {
      question_id: 'systems_thinking.q4_4',
      dimension: 'systems_thinking',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.systems_thinking.q4_4'],
      description: 'Framework for deciding to improve, automate, or eliminate a process.',
      rationale_template: 'Process evaluation framework score: {value}/4.',
    },
    {
      question_id: 'systems_thinking.q4_5',
      dimension: 'systems_thinking',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.systems_thinking.q4_5'],
      description: 'Documentation of tool and process decisions.',
      rationale_template: 'Decision documentation score: {value}/4.',
    },
    {
      question_id: 'systems_thinking.q4_6',
      dimension: 'systems_thinking',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.systems_thinking.q4_6'],
      description: 'Measurement approach for whether a change worked.',
      rationale_template: 'Change measurement maturity score: {value}/4.',
    },
    {
      question_id: 'systems_thinking.q4_7',
      dimension: 'systems_thinking',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.systems_thinking.q4_7'],
      description: 'Comfort decomposing complex workflows into discrete steps.',
      rationale_template: 'Workflow decomposition comfort score: {value}/4.',
    },

    // ------------------------------------------------------------------
    // Dimension 5 — System Integration (7 questions, equal weight)
    // ------------------------------------------------------------------
    {
      question_id: 'system_integration.q5_1',
      dimension: 'system_integration',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.system_integration.q5_1'],
      description: 'Number and inventory status of distinct software tools.',
      rationale_template: 'Tech stack inventory maturity score: {value}/4.',
    },
    {
      question_id: 'system_integration.q5_2',
      dimension: 'system_integration',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.system_integration.q5_2'],
      description: 'How well core systems share data with each other.',
      rationale_template: 'System data-sharing score: {value}/4.',
    },
    {
      question_id: 'system_integration.q5_3',
      dimension: 'system_integration',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.system_integration.q5_3'],
      description: 'API / integration capabilities of key tools.',
      rationale_template: 'API capability score: {value}/4.',
    },
    {
      question_id: 'system_integration.q5_4',
      dimension: 'system_integration',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.system_integration.q5_4'],
      description: 'User access / identity management across tools.',
      rationale_template: 'Identity management maturity score: {value}/4.',
    },
    {
      question_id: 'system_integration.q5_5',
      dimension: 'system_integration',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.system_integration.q5_5'],
      description: 'Manual effort required to move data between systems.',
      rationale_template: 'Data movement automation score: {value}/4.',
    },
    {
      question_id: 'system_integration.q5_6',
      dimension: 'system_integration',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.system_integration.q5_6'],
      description: 'Technical capacity to build or maintain integrations.',
      rationale_template: 'Integration technical capacity score: {value}/4.',
    },
    {
      question_id: 'system_integration.q5_7',
      dimension: 'system_integration',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.system_integration.q5_7'],
      description: 'Stability and currency of the core tech stack.',
      rationale_template: 'Tech stack health score: {value}/4.',
    },

    // ------------------------------------------------------------------
    // Dimension 6 — SOP / Workflow / Automation Adherence (7 questions)
    // ------------------------------------------------------------------
    {
      question_id: 'sop_workflow_automation.q6_1',
      dimension: 'sop_workflow_automation',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.sop_workflow_automation.q6_1'],
      description: 'Documentation of core processes as SOPs.',
      rationale_template: 'SOP coverage score: {value}/4.',
    },
    {
      question_id: 'sop_workflow_automation.q6_2',
      dimension: 'sop_workflow_automation',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.sop_workflow_automation.q6_2'],
      description: 'Consistency of team adherence to documented processes.',
      rationale_template: 'SOP adherence score: {value}/4.',
    },
    {
      question_id: 'sop_workflow_automation.q6_3',
      dimension: 'sop_workflow_automation',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.sop_workflow_automation.q6_3'],
      description: 'SOP maintenance and update cadence.',
      rationale_template: 'SOP maintenance score: {value}/4.',
    },
    {
      question_id: 'sop_workflow_automation.q6_4',
      dimension: 'sop_workflow_automation',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.sop_workflow_automation.q6_4'],
      description: 'Number of already-automated workflows (any tool).',
      rationale_template: 'Automation breadth score: {value}/4.',
    },
    {
      question_id: 'sop_workflow_automation.q6_5',
      dimension: 'sop_workflow_automation',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.sop_workflow_automation.q6_5'],
      description: 'Maintenance durability of existing automations.',
      rationale_template: 'Automation reliability score: {value}/4.',
    },
    {
      question_id: 'sop_workflow_automation.q6_6',
      dimension: 'sop_workflow_automation',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.sop_workflow_automation.q6_6'],
      description: 'Process standardization across people in the same role.',
      rationale_template: 'Role-based standardization score: {value}/4.',
    },
    {
      question_id: 'sop_workflow_automation.q6_7',
      dimension: 'sop_workflow_automation',
      base_weight: EQ7,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.sop_workflow_automation.q6_7'],
      description: 'Documentation of exception and edge-case handling.',
      rationale_template: 'Exception handling maturity score: {value}/4.',
    },

    // ------------------------------------------------------------------
    // Dimension 7 — Current AI Usage (6 scored + 1 roadmap)
    // ------------------------------------------------------------------
    {
      question_id: 'current_ai_usage.q7_1',
      dimension: 'current_ai_usage',
      base_weight: EQ6,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.current_ai_usage.q7_1'],
      description: 'Current organizational use of AI tools.',
      rationale_template: 'AI tool adoption depth score: {value}/4.',
    },

    // Roadmap entry 7.2 — current AI tools inventory (multi-select, unscored)
    {
      question_id: 'current_ai_usage.q7_2',
      dimension: 'current_ai_usage',
      base_weight: 0,
      scoring_function: 'scale_score',
      question_type: 'multi_select',
      enabled: false,
      source_fields: ['ai_readiness_assessment.current_ai_usage.q7_2_selections'],
      description: 'Current AI tools in use (roadmap input — unscored multi-select).',
    },

    {
      question_id: 'current_ai_usage.q7_3',
      dimension: 'current_ai_usage',
      base_weight: EQ6,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.current_ai_usage.q7_3'],
      description: 'Existence and quality of an AI use policy.',
      rationale_template: 'AI policy maturity score: {value}/4.',
    },
    {
      question_id: 'current_ai_usage.q7_4',
      dimension: 'current_ai_usage',
      base_weight: EQ6,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.current_ai_usage.q7_4'],
      description: 'Team-wide AI skill and literacy level.',
      rationale_template: 'AI literacy score: {value}/4.',
    },
    {
      question_id: 'current_ai_usage.q7_5',
      dimension: 'current_ai_usage',
      base_weight: EQ6,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.current_ai_usage.q7_5'],
      description: 'Quality evaluation process for AI tool output.',
      rationale_template: 'AI output review maturity score: {value}/4.',
    },
    {
      question_id: 'current_ai_usage.q7_6',
      dimension: 'current_ai_usage',
      base_weight: EQ6,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.current_ai_usage.q7_6'],
      description: 'Organizational support for AI experimentation.',
      rationale_template: 'AI experimentation support score: {value}/4.',
    },
    {
      question_id: 'current_ai_usage.q7_7',
      dimension: 'current_ai_usage',
      base_weight: EQ6,
      scoring_function: 'scale_score',
      question_type: 'scale_0_to_4',
      enabled: true,
      scale_score_config: SCALE_0_4,
      source_fields: ['ai_readiness_assessment.current_ai_usage.q7_7'],
      description: 'Connectivity of current AI tools to internal data/systems.',
      rationale_template: 'AI system connectivity score: {value}/4.',
    },

    // ------------------------------------------------------------------
    // Policy Governance — retained from v1 (bool + enum scoring)
    // ------------------------------------------------------------------
    {
      question_id: 'policy.has_ai_policy',
      dimension: 'policy_governance',
      base_weight: 0.5,
      scoring_function: 'bool_score',
      question_type: 'boolean',
      enabled: true,
      source_fields: ['ai_readiness.policy.has_ai_policy'],
      rationale_template: 'A documented AI use policy exists: {value}.',
      description: 'A formal or informal AI policy is in place.',
    },
    {
      question_id: 'policy.has_data_classification',
      dimension: 'policy_governance',
      base_weight: 0.3,
      scoring_function: 'bool_score',
      question_type: 'boolean',
      enabled: true,
      source_fields: ['ai_readiness.policy.has_data_classification'],
      rationale_template: 'Data classification scheme exists: {value}.',
      description: 'A data classification scheme is in place.',
    },
    {
      question_id: 'policy.sensitive_data_appetite',
      dimension: 'policy_governance',
      base_weight: 0.2,
      scoring_function: 'enum_score',
      question_type: 'single_select',
      enabled: true,
      enum_score_config: { value_score_mapping: { none: 90, limited: 70, open: 30 } },
      source_fields: ['ai_readiness.policy.sensitive_data_appetite'],
      rationale_template: 'Sensitive-data appetite stance: {value}.',
      description: 'Stance on sending sensitive data to AI tools.',
    },
  ],

  // --------------------------------------------------------------------
  // Dimension weights — 8 active, sum = 1.00
  // The seven MD dimensions (instrument v1.0) sum to 0.90; policy_governance
  // takes the remaining 0.10 drawn equally from management_buy_in (−0.05)
  // and ai_problem_identification (−0.05) vs. the MD baseline.
  // `change_management` stays defined in ScoringDimensionEnum but is absent
  // here so a future v2.1.0 can add it without a shared-package change.
  // --------------------------------------------------------------------
  dimension_weights: [
    {
      dimension: 'data_readiness',
      overall_weight: 0.2,
      min_score_threshold: 50,
      description: 'Data location, quality, accessibility, documentation, governance, structure, and freshness.',
    },
    {
      dimension: 'management_buy_in',
      overall_weight: 0.15,
      min_score_threshold: 60,
      description: 'Leadership stance, budget, ownership, alignment, expectations, change readiness, and ROI definition.',
    },
    {
      dimension: 'policy_governance',
      overall_weight: 0.1,
      min_score_threshold: 55,
      description: 'AI governance, data classification, and sensitive-data appetite.',
    },
    {
      dimension: 'ai_problem_identification',
      overall_weight: 0.05,
      min_score_threshold: 40,
      description: 'Problem clarity, cost quantification, prioritization, repeatability, and baseline metrics.',
    },
    {
      dimension: 'systems_thinking',
      overall_weight: 0.12,
      min_score_threshold: 50,
      description: 'Root-cause analysis, cross-functional visibility, impact awareness, and measurement discipline.',
    },
    {
      dimension: 'system_integration',
      overall_weight: 0.15,
      min_score_threshold: 50,
      description: 'Tool inventory, data sharing, API coverage, identity management, and integration capacity.',
    },
    {
      dimension: 'sop_workflow_automation',
      overall_weight: 0.13,
      min_score_threshold: 50,
      description: 'SOP coverage, adherence, maintenance, automation breadth, and exception handling.',
    },
    {
      dimension: 'current_ai_usage',
      overall_weight: 0.1,
      min_score_threshold: 40,
      description: 'AI adoption depth, policy, literacy, output review, experimentation, and connectivity.',
    },
  ],

  readiness_tiers: [
    {
      label: 'Foundational',
      min: 0,
      max: 39,
      description: 'Prerequisites missing; focus on data, sponsorship, and documentation before deployment.',
    },
    {
      label: 'Emerging',
      min: 40,
      max: 59,
      description: 'Pockets of readiness; viable for a tightly scoped pilot.',
    },
    {
      label: 'Operational',
      min: 60,
      max: 79,
      description: 'Ready for production workflows in 1–2 functions.',
    },
    {
      label: 'Scaling',
      min: 80,
      max: 100,
      description: 'Ready for multi-workflow / agentic deployment and orchestration.',
    },
  ],

  total_score_calculation: 'weighted_average',
  passing_threshold: 60,
  created_by: createdBy,
  created_at: new Date().toISOString(),
  is_active: true,
  changelog: [],
});
