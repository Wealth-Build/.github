import { z } from 'zod';

// 0–4 integer answer for any scored assessment question
const score04 = z.number().int().min(0).max(4).optional();

// ---------------------------------------------------------------------------
// AI Readiness Assessment answer schema — instrument v1.0
//
// Source-field paths in audit-scoring.ts resolve against
// `ai_readiness_assessment.*` within the stored profile jsonb.
// All fields are optional to support partial saves mid-wizard.
// Roadmap-only inputs (multi-selects, free text) live alongside scored answers
// so the full submission is one atomic object.
// ---------------------------------------------------------------------------

export const AiReadinessAssessmentAnswersV2Schema = z.object({
  // Dimension 1 — Data Readiness (q1.1–1.7, all scored)
  data_readiness: z
    .object({
      q1_1: score04, // Where core business data lives
      q1_2: score04, // Data quality and consistency
      q1_3: score04, // Data accessibility
      q1_4: score04, // Data documentation
      q1_5: score04, // Sensitive data governance
      q1_6: score04, // Machine-readable share
      q1_7: score04, // Data update frequency
    })
    .optional(),

  // Dimension 2 — Management Buy-In & Budget (q2.1–2.7, all scored)
  management_buy_in: z
    .object({
      q2_1: score04, // Leadership stance on AI
      q2_2: score04, // Dedicated AI budget
      q2_3: score04, // Accountable owner/sponsor
      q2_4: score04, // Leadership alignment
      q2_5: score04, // Time-to-value expectation
      q2_6: score04, // Change responsiveness
      q2_7: score04, // ROI / success metric definition
    })
    .optional(),

  // Dimension 3 — AI Problem Identification (q3.3–3.7 scored; 3.1 & 3.2 roadmap)
  ai_problem_identification: z
    .object({
      // Roadmap inputs (unscored)
      q3_1_selections: z.array(z.string()).optional(), // Target efficiency problems
      q3_2_text: z.string().max(2000).optional(), // Most painful process (free text)
      // Scored
      q3_3: score04, // Problem articulation clarity
      q3_4: score04, // Problem cost knowledge
      q3_5: score04, // Problem prioritization
      q3_6: score04, // Process repeatability
      q3_7: score04, // Process performance baseline
    })
    .optional(),

  // Dimension 4 — Systems Thinking Protocols (q4.1–4.7, all scored)
  systems_thinking: z
    .object({
      q4_1: score04, // Problem response (reactive vs. systemic)
      q4_2: score04, // Cross-departmental visibility
      q4_3: score04, // Downstream impact consideration
      q4_4: score04, // Improve / automate / eliminate framework
      q4_5: score04, // Tool and process decision documentation
      q4_6: score04, // Change measurement approach
      q4_7: score04, // Workflow decomposition comfort
    })
    .optional(),

  // Dimension 5 — System Integration (q5.1–5.7, all scored)
  system_integration: z
    .object({
      q5_1: score04, // Tool inventory status
      q5_2: score04, // Inter-system data sharing
      q5_3: score04, // API / integration capabilities
      q5_4: score04, // Identity / access management
      q5_5: score04, // Manual data movement effort
      q5_6: score04, // Technical integration capacity
      q5_7: score04, // Tech stack stability and currency
    })
    .optional(),

  // Dimension 6 — SOP / Workflow / Automation Adherence (q6.1–6.7, all scored)
  sop_workflow_automation: z
    .object({
      q6_1: score04, // SOP documentation coverage
      q6_2: score04, // SOP adherence consistency
      q6_3: score04, // SOP maintenance cadence
      q6_4: score04, // Existing automation breadth
      q6_5: score04, // Automation maintenance durability
      q6_6: score04, // Role-based process standardization
      q6_7: score04, // Exception-handling documentation
    })
    .optional(),

  // Dimension 7 — Current AI Usage (q7.1, 7.3–7.7 scored; 7.2 roadmap)
  current_ai_usage: z
    .object({
      q7_1: score04, // Current AI tool usage level
      q7_2_selections: z.array(z.string()).optional(), // AI tools in use (roadmap)
      q7_3: score04, // AI use policy maturity
      q7_4: score04, // Team AI literacy
      q7_5: score04, // AI output evaluation process
      q7_6: score04, // Experimentation support
      q7_7: score04, // AI tool connectivity to data/systems
    })
    .optional(),
});

export type AiReadinessAssessmentAnswersV2 = z.infer<
  typeof AiReadinessAssessmentAnswersV2Schema
>;
