/**
 * ENTIRELY FICTIONAL demonstration matters and documents.
 *
 * Every person, company, hospital, agency, claim and policy below is invented for testing.
 * Each generated document is stamped "FICTIONAL TEST DOCUMENT — NOT A REAL RECORD".
 */
import type { DocumentCategory, MatterFieldKey } from "@/lib/matter-fields";

export const DEMO_DOMAIN = "demo.fabbrinilaw.test";
const e = (local: string) => `${local}@${DEMO_DOMAIN}`;

export const DEMO_USERS = [
  { email: e("maria.lopez"), displayName: "Maria Lopez", jobTitle: "Paralegal", roles: ["EMPLOYEE"], skills: ["demand-letter", "arbitration-package"] },
  { email: e("daniel.kim"), displayName: "Daniel Kim", jobTitle: "Legal Assistant", roles: ["EMPLOYEE"], skills: ["demand-letter"] },
  { email: e("rachel.patel"), displayName: "Rachel Patel", jobTitle: "Associate Attorney", roles: ["EMPLOYEE", "ATTORNEY_REVIEWER"], skills: ["demand-letter", "arbitration-package"] },
  { email: e("jordan.ellis"), displayName: "Jordan Ellis", jobTitle: "Managing Attorney", roles: ["EMPLOYEE", "ATTORNEY_REVIEWER", "FIRM_ADMIN"], skills: ["demand-letter", "arbitration-package"] },
  { email: e("taylor.brooks"), displayName: "Taylor Brooks", jobTitle: "IT Administrator", roles: ["EMPLOYEE", "SYSTEM_ADMIN"], skills: [] },
  { email: e("chris.novak"), displayName: "Chris Novak", jobTitle: "Receptionist", roles: ["EMPLOYEE"], skills: [] },
] as const;

export interface MockDocument {
  id: string;
  name: string;
  category: DocumentCategory;
  kind: "pdf" | "png" | "txt";
  pages: string[];
}

export interface MockMatter {
  id: string;
  displayNumber: string;
  description: string;
  clientName: string;
  practiceArea: string;
  status: "Open" | "Pending" | "Closed";
  responsibleAttorney: string;
  openDate: string;
  accessEmails: string[];
  sampleForTesting?: boolean;
  /** Restricted matters are visible only to the people listed in accessEmails. */
  restricted?: boolean;
  fields: Partial<Record<MatterFieldKey, string>>;
  documents: MockDocument[];
}

const STAMP = "FICTIONAL TEST DOCUMENT - NOT A REAL RECORD";
const pi = [e("maria.lopez"), e("daniel.kim"), e("rachel.patel"), e("jordan.ellis")];

export const MOCK_MATTERS: MockMatter[] = [
  {
    id: "m-1001",
    displayNumber: "2025-0142",
    description: "Thompson v. Ridgeway Logistics LLC",
    clientName: "Angela Thompson",
    practiceArea: "Personal Injury — Motor Vehicle",
    status: "Open",
    responsibleAttorney: "Jordan Ellis",
    openDate: "2025-03-20",
    accessEmails: pi,
    fields: {
      client_name: "Angela Thompson",
      matter_number: "2025-0142",
      matter_description: "Thompson v. Ridgeway Logistics LLC",
      practice_area: "Personal Injury — Motor Vehicle",
      responsible_attorney: "Jordan Ellis",
      // Deliberately differs from the crash report (03/14/2025) to demonstrate conflict detection.
      incident_date: "2025-03-15",
      incident_location: "I-90/94 near 35th Street, Chicago, Illinois",
      incident_type: "Rear-end motor vehicle collision",
      insurance_carrier: "Great Lakes Casualty Insurance Co. (fictional)",
      claim_number: "GLC-25-118842",
      adjuster_name: "Mark Delaney",
      adjuster_address: "Great Lakes Casualty Insurance Co., 100 Example Plaza, Suite 400, Chicago, IL 60601",
      insured_name: "Ridgeway Logistics LLC",
    },
    documents: [
      {
        id: "d-1001-1",
        name: "Traffic Crash Report - MPD-25-0314-0072.pdf",
        category: "police_report",
        kind: "pdf",
        pages: [
          `${STAMP}
METRO POLICE DEPARTMENT (FICTIONAL)
TRAFFIC CRASH REPORT
Report Number: MPD-25-0314-0072
Date of Crash: 03/14/2025
Time: 5:42 PM
Location: Northbound I-90/94 near 35th Street, Chicago, IL
Unit 1 Driver: Angela Thompson (2019 Honda Civic)
Unit 2 Driver: Kevin Marsh, operating a box truck owned by Ridgeway Logistics LLC
Narrative: Unit 1 was stopped in traffic in the center lane. Unit 2 failed to reduce speed and struck the rear of Unit 1. The driver of Unit 2 stated that he looked down at his navigation device. The driver of Unit 1 complained of neck and back pain and was transported by ambulance.
Citations: Unit 2 driver cited for failure to reduce speed to avoid a crash.
Officer: Badge 4417 (fictional)`,
        ],
      },
      {
        id: "d-1001-2",
        name: "Lakeshore General Hospital - ER Records.pdf",
        category: "medical_records",
        kind: "pdf",
        pages: [
          `${STAMP}
LAKESHORE GENERAL HOSPITAL (FICTIONAL) - EMERGENCY DEPARTMENT RECORD
Provider: Lakeshore General Hospital
Patient: Angela Thompson
Date of Service: 03/14/2025
Arrival: By ambulance (Metro Ambulance Service)
Chief Complaint: Neck pain and lower back pain following motor vehicle collision.
Diagnosis: Cervical strain (whiplash injury); lumbar strain.
Treatment: CT scan of the cervical spine, negative for fracture. Prescribed cyclobenzaprine and ibuprofen.
Plan: Follow up with primary care physician. Referral to physical therapy.`,
        ],
      },
      {
        id: "d-1001-3",
        name: "Northside Physical Therapy - Records.pdf",
        category: "medical_records",
        kind: "pdf",
        pages: [
          `${STAMP}
NORTHSIDE PHYSICAL THERAPY (FICTIONAL) - INITIAL EVALUATION
Provider: Northside Physical Therapy
Patient: Angela Thompson
Date of Service: 03/24/2025
Diagnosis: Cervical strain; lumbar strain.
Treatment: Initial evaluation. Plan of care: therapeutic exercise and manual therapy, two visits per week for eight weeks.`,
          `${STAMP}
NORTHSIDE PHYSICAL THERAPY (FICTIONAL) - DISCHARGE SUMMARY
Provider: Northside Physical Therapy
Patient: Angela Thompson
Date of Service: 05/16/2025
Diagnosis: Cervical strain; lumbar strain, improving.
Treatment: Sixteen therapy visits completed from 03/24/2025 through 05/16/2025.
Plan: Discharged to home exercise program. Patient reports residual intermittent neck stiffness.`,
        ],
      },
      {
        id: "d-1001-4",
        name: "Midwest Orthopedic Partners - Consultation.pdf",
        category: "medical_records",
        kind: "pdf",
        pages: [
          `${STAMP}
MIDWEST ORTHOPEDIC PARTNERS (FICTIONAL) - CONSULTATION NOTE
Provider: Midwest Orthopedic Partners
Patient: Angela Thompson
Date of Service: 06/02/2025
Diagnosis: Cervical radiculopathy symptoms; C5-C6 disc bulge shown on MRI.
Treatment: Orthopedic consultation and review of cervical MRI.
Recommendation: Cervical epidural steroid injection if symptoms persist after six weeks.`,
        ],
      },
      {
        id: "d-1001-5",
        name: "Lakeshore General Hospital - Itemized Bill.pdf",
        category: "medical_bills",
        kind: "pdf",
        pages: [
          `${STAMP}
LAKESHORE GENERAL HOSPITAL (FICTIONAL) - ITEMIZED STATEMENT
Provider: Lakeshore General Hospital
Patient: Angela Thompson
Dates of Service: 03/14/2025
Emergency department visit, level 4 ........ $2,415.00
CT cervical spine without contrast .......... $3,980.00
Pharmacy ................................... $447.00
TOTAL CHARGES: $6,842.00`,
        ],
      },
      {
        id: "d-1001-6",
        name: "Northside Physical Therapy - Billing Ledger.pdf",
        category: "medical_bills",
        kind: "pdf",
        pages: [
          `${STAMP}
NORTHSIDE PHYSICAL THERAPY (FICTIONAL) - BILLING LEDGER
Provider: Northside Physical Therapy
Patient: Angela Thompson
Dates of Service: 03/24/2025 - 05/16/2025
Initial evaluation ......................... $320.00
Therapy visits (15 visits) .................. $4,640.00
TOTAL CHARGES: $4,960.00`,
        ],
      },
      {
        id: "d-1001-7",
        name: "Metro Ambulance Service - Invoice.pdf",
        category: "medical_bills",
        kind: "pdf",
        pages: [
          `${STAMP}
METRO AMBULANCE SERVICE (FICTIONAL) - INVOICE
Provider: Metro Ambulance Service
Patient: Angela Thompson
Dates of Service: 03/14/2025
Advanced life support transport ............ $1,275.00
TOTAL CHARGES: $1,275.00`,
        ],
      },
      {
        id: "d-1001-8",
        name: "Ridge Street Dental Group - Wage Verification.pdf",
        category: "wage_loss",
        kind: "pdf",
        pages: [
          `${STAMP}
RIDGE STREET DENTAL GROUP (FICTIONAL) - EMPLOYER WAGE VERIFICATION
Employer: Ridge Street Dental Group
Employee: Angela Thompson
Position: Dental Hygienist
Hourly Rate: $38.50
Time Missed: 72 hours between 03/15/2025 and 04/11/2025
Total Lost Wages: $2,772.00`,
        ],
      },
    ],
  },
  {
    id: "m-1002",
    displayNumber: "2024-0388",
    description: "Rivera — Uninsured Motorist Claim (Sentinel Mutual)",
    clientName: "Luis Rivera",
    practiceArea: "Personal Injury — UM/UIM",
    status: "Open",
    responsibleAttorney: "Rachel Patel",
    openDate: "2024-08-12",
    accessEmails: [e("maria.lopez"), e("rachel.patel"), e("jordan.ellis")],
    fields: {
      client_name: "Luis Rivera",
      matter_number: "2024-0388",
      matter_description: "Rivera — Uninsured Motorist Claim (Sentinel Mutual)",
      practice_area: "Personal Injury — UM/UIM",
      responsible_attorney: "Rachel Patel",
      incident_date: "2024-08-02",
      incident_location: "Cicero Avenue and 63rd Street, Chicago, Illinois",
      incident_type: "Hit-and-run collision (uninsured motorist)",
      um_carrier: "Sentinel Mutual Insurance Company (fictional)",
      um_policy_number: "SM-4471902",
      um_limits: "100000.00",
      case_number: "AAA 01-25-0004-1187 (fictional)",
      opposing_counsel: "Harper & Lowe LLP (fictional)",
    },
    documents: [
      {
        id: "d-1002-1",
        name: "Demand for Arbitration - Rivera.pdf",
        category: "arbitration_filing",
        kind: "pdf",
        pages: [
          `${STAMP}
DEMAND FOR ARBITRATION (FICTIONAL)
Claimant: Luis Rivera
Respondent: Sentinel Mutual Insurance Company
Nature of Claim: Uninsured motorist bodily injury claim arising from a hit-and-run collision on 08/02/2024.
Policy Number: SM-4471902
Amount Claimed: To be determined by the arbitrator, not to exceed applicable limits.`,
        ],
      },
      {
        id: "d-1002-2",
        name: "Sentinel Mutual - Policy Declarations.pdf",
        category: "insurance_policy",
        kind: "pdf",
        pages: [
          `${STAMP}
SENTINEL MUTUAL INSURANCE COMPANY (FICTIONAL) - AUTO POLICY DECLARATIONS
Insurance Company: Sentinel Mutual Insurance Company
Policy Number: SM-4471902
Named Insured: Luis Rivera
Policy Period: 01/01/2024 to 01/01/2025
Uninsured Motorist Bodily Injury Limits: $100,000.00 each person / $300,000.00 each accident`,
        ],
      },
      {
        id: "d-1002-3",
        name: "Traffic Crash Report - MPD-24-0802-0310.pdf",
        category: "police_report",
        kind: "pdf",
        pages: [
          `${STAMP}
METRO POLICE DEPARTMENT (FICTIONAL)
TRAFFIC CRASH REPORT
Report Number: MPD-24-0802-0310
Date of Crash: 08/02/2024
Time: 11:15 AM
Location: Cicero Avenue at 63rd Street, Chicago, IL
Unit 1 Driver: Luis Rivera
Unit 2 Driver: Unknown (fled the scene)
Narrative: Unit 2 entered the intersection against a red signal and struck the driver side of Unit 1. Unit 2 left the scene without stopping. An independent witness provided a statement.
Citations: None issued; Unit 2 driver not identified.`,
        ],
      },
      {
        id: "d-1002-4",
        name: "Southwest Community Hospital - ER Records.pdf",
        category: "medical_records",
        kind: "pdf",
        pages: [
          `${STAMP}
SOUTHWEST COMMUNITY HOSPITAL (FICTIONAL) - EMERGENCY DEPARTMENT RECORD
Provider: Southwest Community Hospital
Patient: Luis Rivera
Date of Service: 08/02/2024
Diagnosis: Left shoulder contusion; cervical strain.
Treatment: X-ray of left shoulder, negative for fracture. Sling provided.
Plan: Follow up with chiropractic or orthopedic care.`,
        ],
      },
      {
        id: "d-1002-5",
        name: "Westlawn Chiropractic - Treatment Records.pdf",
        category: "medical_records",
        kind: "pdf",
        pages: [
          `${STAMP}
WESTLAWN CHIROPRACTIC (FICTIONAL) - TREATMENT SUMMARY
Provider: Westlawn Chiropractic
Patient: Luis Rivera
Date of Service: 08/09/2024
Diagnosis: Cervical strain; left shoulder strain.
Treatment: Twenty-two chiropractic visits from 08/09/2024 through 11/22/2024.`,
        ],
      },
      {
        id: "d-1002-6",
        name: "Southwest Community Hospital - Bill.pdf",
        category: "medical_bills",
        kind: "pdf",
        pages: [
          `${STAMP}
SOUTHWEST COMMUNITY HOSPITAL (FICTIONAL) - STATEMENT OF CHARGES
Provider: Southwest Community Hospital
Patient: Luis Rivera
Dates of Service: 08/02/2024
TOTAL CHARGES: $3,615.00`,
        ],
      },
      {
        id: "d-1002-7",
        name: "Westlawn Chiropractic - Bill.pdf",
        category: "medical_bills",
        kind: "pdf",
        pages: [
          `${STAMP}
WESTLAWN CHIROPRACTIC (FICTIONAL) - ACCOUNT STATEMENT
Provider: Westlawn Chiropractic
Patient: Luis Rivera
Dates of Service: 08/09/2024 - 11/22/2024
TOTAL CHARGES: $5,280.00`,
        ],
      },
      {
        id: "d-1002-8",
        name: "Vehicle Damage Photo 1.png",
        category: "photographs",
        kind: "png",
        pages: ["Fictional placeholder photograph of vehicle damage"],
      },
      {
        id: "d-1002-9",
        name: "Witness Statement - J. Okonkwo.txt",
        category: "witness_statement",
        kind: "txt",
        pages: [
          `${STAMP}
WITNESS STATEMENT (FICTIONAL)
Witness: Jamal Okonkwo
I was waiting to cross at Cicero and 63rd. A dark sedan drove through the red light and hit the side of a silver car. The sedan did not stop.`,
        ],
      },
    ],
  },
  {
    id: "m-1003",
    displayNumber: "2025-0217",
    description: "Okafor v. Midway Fresh Market",
    clientName: "Grace Okafor",
    practiceArea: "Personal Injury — Premises Liability",
    status: "Open",
    responsibleAttorney: "Jordan Ellis",
    openDate: "2025-07-01",
    accessEmails: pi,
    fields: {
      client_name: "Grace Okafor",
      matter_number: "2025-0217",
      matter_description: "Okafor v. Midway Fresh Market",
      practice_area: "Personal Injury — Premises Liability",
      responsible_attorney: "Jordan Ellis",
      incident_date: "2025-06-21",
      incident_location: "Midway Fresh Market, 5000 Example Avenue, Chicago, Illinois",
      incident_type: "Slip and fall",
      insurance_carrier: "Prairie State Mutual (fictional)",
      claim_number: "PSM-77120",
      adjuster_name: "Lena Ortiz",
      insured_name: "Midway Fresh Market, Inc.",
    },
    documents: [
      {
        id: "d-1003-1",
        name: "Store Incident Report.pdf",
        category: "police_report",
        kind: "pdf",
        pages: [
          `${STAMP}
MIDWAY FRESH MARKET (FICTIONAL) - CUSTOMER INCIDENT REPORT
Report Number: MFM-0621-03
Date of Incident: 06/21/2025
Location: Aisle 7 (produce), Midway Fresh Market
Narrative: Customer slipped on water near the produce misting system. No wet-floor sign was posted. Customer reported right wrist pain.`,
        ],
      },
      {
        id: "d-1003-2",
        name: "QuickCare Urgent Care - Visit Note.pdf",
        category: "medical_records",
        kind: "pdf",
        pages: [
          `${STAMP}
QUICKCARE URGENT CARE (FICTIONAL) - VISIT NOTE
Provider: QuickCare Urgent Care
Patient: Grace Okafor
Date of Service: 06/21/2025
Diagnosis: Right wrist sprain.
Treatment: X-ray negative for fracture. Wrist splint applied.`,
        ],
      },
    ],
  },
  {
    id: "m-1004",
    displayNumber: "2025-0301",
    description: "People v. D. Hartley",
    clientName: "Devon Hartley",
    practiceArea: "Criminal Defense",
    status: "Open",
    responsibleAttorney: "Jordan Ellis",
    openDate: "2025-09-03",
    accessEmails: [e("rachel.patel"), e("jordan.ellis")],
    restricted: true,
    fields: { client_name: "Devon Hartley", matter_number: "2025-0301", matter_description: "People v. D. Hartley", practice_area: "Criminal Defense" },
    documents: [],
  },
  {
    id: "m-9001",
    displayNumber: "TEST-0001",
    description: "Sample Test Matter — Jane Sample (fictional)",
    clientName: "Jane Sample",
    practiceArea: "Personal Injury — Test Data",
    status: "Open",
    responsibleAttorney: "Test Attorney",
    openDate: "2025-01-01",
    accessEmails: [],
    sampleForTesting: true,
    fields: {
      client_name: "Jane Sample",
      matter_number: "TEST-0001",
      matter_description: "Sample Test Matter — Jane Sample (fictional)",
      practice_area: "Personal Injury — Test Data",
      responsible_attorney: "Test Attorney",
      incident_date: "2025-01-10",
      incident_location: "Example Road and Sample Street, Chicago, Illinois",
      incident_type: "Motor vehicle collision",
      insurance_carrier: "Example Insurance Company (fictional)",
      claim_number: "EX-0000-TEST",
      adjuster_name: "Alex Example",
      insured_name: "John Example",
      policy_limits: "50000.00",
    },
    documents: [
      {
        id: "d-9001-1",
        name: "Sample Crash Report.pdf",
        category: "police_report",
        kind: "pdf",
        pages: [
          `${STAMP}
SAMPLE POLICE DEPARTMENT (FICTIONAL) - TRAFFIC CRASH REPORT
Report Number: TEST-RPT-001
Date of Crash: 01/10/2025
Location: Example Road and Sample Street, Chicago, IL
Narrative: Unit 2 ran a stop sign and struck Unit 1 (Jane Sample).
Citations: Unit 2 cited for failure to stop.`,
        ],
      },
      {
        id: "d-9001-2",
        name: "Sample Clinic Record.pdf",
        category: "medical_records",
        kind: "pdf",
        pages: [
          `${STAMP}
SAMPLE CLINIC (FICTIONAL) - VISIT NOTE
Provider: Sample Clinic
Patient: Jane Sample
Date of Service: 01/11/2025
Diagnosis: Lumbar strain.
Treatment: Examination and home exercise instructions.`,
        ],
      },
      {
        id: "d-9001-3",
        name: "Sample Clinic Bill.pdf",
        category: "medical_bills",
        kind: "pdf",
        pages: [
          `${STAMP}
SAMPLE CLINIC (FICTIONAL) - STATEMENT
Provider: Sample Clinic
Patient: Jane Sample
Dates of Service: 01/11/2025
TOTAL CHARGES: $450.00`,
        ],
      },
    ],
  },
];
