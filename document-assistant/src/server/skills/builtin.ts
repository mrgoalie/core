/**
 * The two initial skills, defined purely as configuration (the same building blocks the
 * no-code Skill Builder offers). Administrators can edit, version, duplicate or retire them.
 */
import { SkillConfig, type SkillConfigInput } from "@/lib/skill-config";

const DEMO_NOTICE = "Demonstration template: replace with the firm's approved demand letter template before real use.";

export const DEMAND_LETTER: SkillConfigInput = {
  schemaVersion: 1,
  name: "Write a Demand Letter",
  shortDescription: "Prepare a personal-injury settlement demand to the insurance company from the case file and medical records.",
  employeeInstructions:
    "Choose the client's case. Check the documents we found and add anything missing. Review the information we filled in, then create the draft. An attorney must approve the letter before it can be sent.",
  purpose:
    "Prepare a settlement demand letter to the at-fault party's liability insurance company for our personal-injury client. Explain how the incident happened and why the insured is responsible, describe the injuries and medical treatment exactly as documented in the medical records, present the economic damages (medical expenses and lost wages) using the calculated totals, describe the effect of the injuries on the client's daily life as reported by our staff, and state the demand amount provided by the attorney. Do not include legal citations unless an attorney has supplied them. Flag anything that is missing or inconsistent.",
  icon: "mail",
  category: "Personal Injury",
  matter: { showFields: ["client_name", "matter_number", "incident_date", "insurance_carrier", "claim_number", "adjuster_name"] },
  allowUploads: true,
  notices: [DEMO_NOTICE],
  inputs: [
    { id: "recipient_name", label: "Adjuster's name", type: "text", required: true, group: "Who the letter is going to", prefill: { source: "matter", field: "adjuster_name" } },
    { id: "insurance_company", label: "Insurance company", type: "text", required: true, group: "Who the letter is going to", prefill: { source: "matter", field: "insurance_carrier" } },
    { id: "recipient_address", label: "Mailing address", type: "longtext", required: true, group: "Who the letter is going to", prefill: { source: "matter", field: "adjuster_address" } },
    { id: "claim_no", label: "Claim number", type: "text", required: true, group: "Who the letter is going to", prefill: { source: "matter", field: "claim_number" } },
    { id: "insured", label: "Their insured (the at-fault party)", type: "text", required: true, group: "Who the letter is going to", prefill: { source: "matter", field: "insured_name" } },
    {
      id: "loss_date",
      label: "Date of the incident",
      type: "date",
      required: true,
      group: "What happened",
      helpText: "Filled in from the crash report when one is available.",
      prefill: { source: "extracted", key: "incident.date" },
    },
    { id: "loss_location", label: "Where it happened", type: "text", required: true, group: "What happened", prefill: { source: "extracted", key: "incident.location" } },
    {
      id: "incident_description",
      label: "What happened",
      type: "longtext",
      required: true,
      group: "What happened",
      helpText: "Describe the incident in plain words. Stick to what the report and the client say.",
      prefill: { source: "extracted", key: "incident.narrative" },
    },
    {
      id: "liability_summary",
      label: "Why the other party is responsible",
      type: "longtext",
      required: true,
      group: "What happened",
      helpText: "For example: the other driver was ticketed, admitted fault, or ran a red light. Include only what is supported.",
    },
    {
      id: "injuries_description",
      label: "Injuries documented in the medical records",
      type: "longtext",
      required: true,
      group: "Injuries and treatment",
      prefill: { source: "extracted", key: "injuries" },
      requiresSource: true,
    },
    {
      id: "treatment",
      label: "Medical treatment",
      type: "table",
      required: true,
      group: "Injuries and treatment",
      prefill: { source: "extracted", key: "treatment" },
      columns: [
        { id: "provider", label: "Provider", type: "text", required: true },
        { id: "dates", label: "Date(s)", type: "text", required: true },
        { id: "treatment", label: "Treatment", type: "longtext", required: false },
      ],
    },
    {
      id: "future_treatment",
      label: "Recommended future treatment",
      type: "longtext",
      required: false,
      group: "Injuries and treatment",
      helpText: "Only include future care that a doctor has recommended in writing.",
      prefill: { source: "extracted", key: "future_treatment" },
      requiresSource: true,
    },
    {
      id: "medical_bills",
      label: "Medical bills",
      type: "table",
      required: true,
      group: "Damages",
      prefill: { source: "extracted", key: "bills" },
      columns: [
        { id: "provider", label: "Provider", type: "text", required: true },
        { id: "dates", label: "Dates of service", type: "text", required: false },
        { id: "amount", label: "Amount billed", type: "currency", required: true },
      ],
    },
    { id: "lost_wages", label: "Lost wages", type: "currency", required: false, group: "Damages", prefill: { source: "extracted", key: "wages.amount" } },
    {
      id: "non_economic",
      label: "How the injuries have affected the client's life",
      type: "longtext",
      required: true,
      group: "Damages",
      helpText: "Pain, sleep, work, family and activities — in the client's own words as told to our office.",
    },
    { id: "demand_type", label: "Type of demand", type: "select", required: true, group: "The demand", options: ["Standard demand", "Policy-limits demand"], defaultValue: "Standard demand" },
    {
      id: "known_limits",
      label: "Policy limits (if known)",
      type: "currency",
      required: false,
      group: "The demand",
      prefill: { source: "matter", field: "policy_limits" },
      showWhen: { inputId: "demand_type", equals: ["Policy-limits demand"] },
    },
    {
      id: "demand_amount",
      label: "Demand amount",
      type: "currency",
      required: true,
      group: "The demand",
      helpText: "Enter the amount the attorney gave you. If you don't have it yet, leave it blank — the draft will flag it for the attorney.",
    },
    { id: "response_days", label: "Days the insurer has to respond", type: "number", required: true, group: "The demand", defaultValue: "30" },
  ],
  documents: [
    { id: "crash_report", label: "Police or crash report", categories: ["police_report"], required: true, multiple: false, analyzer: "incident_report" },
    { id: "medical_records", label: "Medical records", categories: ["medical_records"], required: true, multiple: true, analyzer: "medical_records" },
    { id: "medical_bills", label: "Medical bills", categories: ["medical_bills"], required: true, multiple: true, analyzer: "medical_bills" },
    { id: "wage_docs", label: "Lost wage documentation", categories: ["wage_loss"], required: false, multiple: true, analyzer: "wage_loss" },
    { id: "photos", label: "Photographs", categories: ["photographs"], required: false, multiple: true, analyzer: "none" },
  ],
  calculations: [
    { id: "medical_specials", label: "Total medical expenses", operation: "sum_column", operands: [{ kind: "input", inputId: "medical_bills", column: "amount" }], format: "currency", showInDocument: true },
    { id: "lost_wages_total", label: "Lost wages", operation: "add", operands: [{ kind: "input", inputId: "lost_wages", blankAsZero: true }], format: "currency", showInDocument: true },
    {
      id: "total_specials",
      label: "Total economic damages",
      operation: "add",
      operands: [
        { kind: "calc", calcId: "medical_specials" },
        { kind: "calc", calcId: "lost_wages_total" },
      ],
      format: "currency",
      showInDocument: true,
    },
  ],
  drafting: {
    tone: "Professional, firm and factual. Persuasive but never exaggerated.",
    sections: [
      { id: "intro", heading: "", mode: "ai", instructions: "Open the letter. State that the firm represents the client, give the date and place of the incident, and explain that the letter presents the client's claim and a settlement demand." },
      { id: "incident", heading: "Facts of the Incident", mode: "ai", instructions: "Describe how the incident happened, based only on the incident description and the crash report facts." },
      { id: "liability", heading: "Liability", mode: "ai", instructions: "Explain why the insured is responsible, using only the liability summary and any citation information provided." },
      {
        id: "injuries",
        heading: "Injuries and Medical Treatment",
        mode: "ai",
        instructions: "Describe the documented injuries and summarize the treatment chronologically. Use only diagnoses and treatment that appear in the facts.",
        attach: { tables: ["treatment"], calculations: false },
      },
      { id: "future_care", heading: "Future Medical Care", mode: "ai", instructions: "If a provider recommended future treatment, describe it exactly as recommended. If none is provided, say that no future care is claimed at this time." },
      {
        id: "damages",
        heading: "Economic Damages",
        mode: "ai",
        instructions: "Present medical expenses and lost wages using the calculated totals exactly as given. Refer to the itemized table.",
        attach: { tables: ["medical_bills"], calculations: true },
      },
      { id: "non_economic", heading: "Non-Economic Damages", mode: "ai", instructions: "Describe the effect of the injuries on the client's daily life using the staff-provided description. Do not exaggerate." },
      { id: "demand", heading: "Settlement Demand", mode: "ai", instructions: "State the demand amount exactly as provided and the number of days to respond. If no amount is provided, insert a [MISSING] placeholder." },
      { id: "closing", heading: "", mode: "fixed", text: "Thank you for your prompt attention to this matter. Please contact our office with any questions." },
    ],
  },
  output: {
    style: "letter",
    formats: ["docx", "pdf"],
    documentTitle: "Settlement Demand",
    templateId: null,
    letter: {
      recipientInputIds: ["recipient_name", "insurance_company", "recipient_address"],
      reLines: [
        { label: "Our Client", source: { kind: "matter", field: "client_name" } },
        { label: "Your Insured", source: { kind: "input", inputId: "insured" } },
        { label: "Claim No.", source: { kind: "input", inputId: "claim_no" } },
        { label: "Date of Loss", source: { kind: "input", inputId: "loss_date" } },
      ],
      salutation: "Dear {{recipient_name}}:",
      signatureLines: ["Very truly yours,", "", "{{firm_name}}", "", "", "______________________________", "{{responsible_attorney}}"],
      listEnclosures: true,
    },
  },
  approval: {
    reviewerRole: "ATTORNEY_REVIEWER",
    reviewerGuidance: "Confirm the demand amount, every statement about liability, and that each injury and expense is supported by the enclosed records.",
  },
};

const UM = "AAA — Uninsured Motorist (UM)";
const UIM = "AAA — Underinsured Motorist (UIM)";

export const ARBITRATION_PACKAGE: SkillConfigInput = {
  schemaVersion: 1,
  name: "Create an Arbitration Package",
  shortDescription: "Assemble exhibits, an exhibit index and a cover letter into one organized, page-numbered PDF.",
  employeeInstructions:
    "Choose the case and the type of arbitration. Tick the exhibits to include and put them in order. We'll build the package and show anything that's still missing.",
  purpose:
    "Assemble an arbitration exhibit package for a personal-injury claimant: a cover sheet, an exhibit index, and each selected exhibit with a slip sheet, page numbers and Bates numbers, plus a short cover letter. Report any required exhibits that are missing.",
  icon: "scale",
  category: "Arbitration",
  matter: { showFields: ["client_name", "matter_number", "um_carrier", "um_policy_number", "case_number", "incident_date"] },
  allowUploads: true,
  notices: [
    "Exhibit requirements in this skill are DEMONSTRATION settings. They have not been checked against AAA or court rules. The firm must replace them with approved requirements before real use.",
  ],
  inputs: [
    {
      id: "arbitration_type",
      label: "Type of arbitration",
      type: "select",
      required: true,
      options: [UM, UIM, "Court-annexed mandatory arbitration", "Other arbitration"],
      helpText: "This decides which exhibits are on the checklist.",
    },
    { id: "respondent", label: "Insurance company (respondent)", type: "text", required: true, prefill: { source: "matter", field: "um_carrier" } },
    { id: "forum_case_number", label: "Arbitration case number", type: "text", required: false, prefill: { source: "matter", field: "case_number" } },
    { id: "hearing_date", label: "Hearing date", type: "date", required: false },
    { id: "arbitrator", label: "Arbitrator (if assigned)", type: "text", required: false },
    { id: "recipient", label: "Cover letter goes to (name and address)", type: "longtext", required: false, helpText: "Usually the arbitrator or the forum's case administrator." },
    {
      id: "medical_bills",
      label: "Medical charges included",
      type: "table",
      required: false,
      prefill: { source: "extracted", key: "bills" },
      columns: [
        { id: "provider", label: "Provider", type: "text", required: true },
        { id: "dates", label: "Dates of service", type: "text", required: false },
        { id: "amount", label: "Amount billed", type: "currency", required: true },
      ],
    },
  ],
  documents: [
    { id: "arb_demand", label: "Arbitration demand or filing", categories: ["arbitration_filing"], required: true, multiple: false, analyzer: "none" },
    { id: "policy", label: "Policy declarations page", categories: ["insurance_policy"], required: true, multiple: false, analyzer: "insurance" },
    { id: "crash_report", label: "Police or crash report", categories: ["police_report"], required: true, multiple: false, analyzer: "none" },
    { id: "records", label: "Medical records", categories: ["medical_records"], required: true, multiple: true, analyzer: "none" },
    { id: "bills", label: "Medical bills", categories: ["medical_bills"], required: true, multiple: true, analyzer: "medical_bills" },
    { id: "wages", label: "Lost wage documentation", categories: ["wage_loss"], required: false, multiple: true, analyzer: "none" },
    { id: "photos", label: "Photographs", categories: ["photographs"], required: false, multiple: true, analyzer: "none" },
    { id: "witness", label: "Witness statements", categories: ["witness_statement"], required: false, multiple: true, analyzer: "none" },
    {
      id: "insurer_notice",
      label: "Correspondence giving notice of the claim to the insurer",
      categories: ["correspondence"],
      required: true,
      multiple: true,
      analyzer: "none",
      appliesWhen: { inputId: "arbitration_type", equals: [UM, UIM] },
    },
    {
      id: "underlying_settlement",
      label: "Underlying liability settlement or tender documents",
      categories: ["settlement_documents"],
      required: true,
      multiple: true,
      analyzer: "none",
      appliesWhen: { inputId: "arbitration_type", equals: [UIM] },
    },
  ],
  calculations: [
    { id: "medical_total", label: "Total medical charges in this package", operation: "sum_column", operands: [{ kind: "input", inputId: "medical_bills", column: "amount", blankAsZero: true }], format: "currency", showInDocument: true },
  ],
  drafting: {
    tone: "Formal and concise.",
    sections: [
      {
        id: "cover",
        heading: "",
        mode: "fixed",
        text: "Enclosed is the exhibit package submitted on behalf of claimant {{client_name}} in the arbitration with {{respondent}}, case number {{forum_case_number}}. The package contains {{exhibit_count}} exhibits totaling {{package_pages}} pages, as listed in the enclosed exhibit index.",
        attach: { tables: [], calculations: true },
      },
      { id: "closing", heading: "", mode: "fixed", text: "Please contact our office if you need anything further." },
    ],
  },
  output: {
    style: "letter",
    formats: ["pdf_package", "docx"],
    documentTitle: "Arbitration Exhibit Package",
    templateId: null,
    letter: {
      recipientInputIds: ["recipient"],
      reLines: [
        { label: "Claimant", source: { kind: "matter", field: "client_name" } },
        { label: "Respondent", source: { kind: "input", inputId: "respondent" } },
        { label: "Case No.", source: { kind: "input", inputId: "forum_case_number" } },
        { label: "Hearing Date", source: { kind: "input", inputId: "hearing_date" } },
      ],
      salutation: "To the Arbitrator:",
      signatureLines: ["Respectfully submitted,", "", "{{firm_name}}", "", "", "______________________________", "{{responsible_attorney}}"],
      listEnclosures: false,
    },
    package: {
      title: "Arbitration Exhibit Package",
      includeCoverSheet: true,
      includeExhibitIndex: true,
      slipSheets: true,
      batesPrefix: "FLG",
      batesStart: 1,
      pageNumbers: true,
      bookmarks: true,
    },
  },
  approval: {
    reviewerRole: "ATTORNEY_REVIEWER",
    reviewerGuidance: "Confirm the exhibit order, that nothing privileged is included, and that the package satisfies the forum's actual rules.",
  },
};

export const BUILTIN_SKILLS = [
  { slug: "demand-letter", config: DEMAND_LETTER },
  { slug: "arbitration-package", config: ARBITRATION_PACKAGE },
] as const;

// Fail fast at startup if a built-in definition ever drifts out of the schema.
for (const s of BUILTIN_SKILLS) SkillConfig.parse(s.config);
