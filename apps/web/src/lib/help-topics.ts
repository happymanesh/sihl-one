import type { Permission } from '@sihl-one/contracts';

/**
 * In-app help, keyed to the permission each task actually requires.
 *
 * Filtered the same way the navigation is: by the permission strings the API
 * enforces, not by job title. That means one mapping rather than two — when a
 * role gains a permission it gains the matching help the same day, and nobody
 * reads instructions for a button they will never see.
 *
 * `permission: null` means everyone who can sign in.
 *
 * Written as steps rather than prose because it is read on a phone, one-handed,
 * by somebody who is stuck mid-task and wants the next tap.
 */
export interface HelpTopic {
  id: string;
  title: string;
  permission: Permission | null;
  area: HelpArea;
  steps: string[];
  /** Shown under the steps where a rule is easy to trip over. */
  note?: string;
}

export type HelpArea =
  | 'Getting started'
  | 'Leads'
  | 'Conversations and tasks'
  | 'Visits'
  | 'Reporting'
  | 'Administration';

export const HELP_AREAS: HelpArea[] = [
  'Getting started',
  'Leads',
  'Conversations and tasks',
  'Visits',
  'Reporting',
  'Administration',
];

export const HELP_TOPICS: HelpTopic[] = [
  // ---- Getting started ----------------------------------------------------
  {
    id: 'sign-in',
    title: 'Signing in',
    permission: null,
    area: 'Getting started',
    steps: [
      'Open the app and enter your email, your mobile number, or your code.',
      'Staff codes look like SIHL-0042. Partners use the code the back office issued you.',
      'Enter your password and choose Sign in.',
    ],
    note: 'Five wrong attempts locks the account for 15 minutes. If you are unsure of the password, ask an administrator rather than guessing.',
  },
  {
    id: 'change-password',
    title: 'Changing your password',
    permission: null,
    area: 'Getting started',
    steps: [
      'Open the menu under your initials, top right.',
      'Choose Security.',
      'Enter your current password, then your new one twice.',
    ],
    note: 'You will be signed out on every device and will need to sign in again. That is deliberate — a password change that left old sessions running would not have changed anything.',
  },
  {
    id: 'two-step',
    title: 'Turning on two-step verification',
    permission: null,
    area: 'Getting started',
    steps: [
      'Open your initials, top right, then Security.',
      'Scan the square code with Google Authenticator or any authenticator app.',
      'Type the six-digit code it shows to confirm.',
    ],
    note: 'Keep the recovery codes somewhere safe. Without them, a lost phone means an administrator has to reset your access.',
  },

  // ---- Leads --------------------------------------------------------------
  {
    id: 'add-lead',
    title: 'Adding a lead',
    permission: 'lead:create',
    area: 'Leads',
    steps: [
      'Leads, then New lead.',
      'Name and mobile are required. Everything else can wait.',
      'Tick the products they asked about, then Create.',
    ],
    note: 'Additional information — occupation, income, family — is optional and collapsed. Open it only when you actually know something.',
  },
  {
    id: 'duplicate-warning',
    title: 'When the mobile number is already on the book',
    permission: 'lead:create',
    area: 'Leads',
    steps: [
      'Type the mobile. The check runs on its own once ten digits are in.',
      'If it is already ours, a note appears under the field with the name, who owns it and when it came in.',
      'Choose View details to see the record, then Open the lead to go there.',
      'Talk to whoever owns it rather than creating a second lead.',
    ],
    note: 'If the lead belongs to a team outside your access you are told only that the number is taken, not whose it is. An open duplicate is refused when you save; a closed one is only a warning, and reopening the old lead is usually better than starting a twin.',
  },
  {
    id: 'import-leads',
    title: 'Importing leads from a spreadsheet',
    permission: 'lead:import',
    area: 'Leads',
    steps: [
      'Leads, then Import.',
      'Upload the file and match your columns to the fields shown.',
      'Review what it found, then commit the batch.',
    ],
    note: 'Duplicates are flagged before anything is saved. Check that list — it is easier than merging afterwards.',
  },
  {
    id: 'verify-mobile',
    title: 'Confirming a lead mobile number',
    permission: 'lead:update',
    area: 'Leads',
    steps: [
      'Open the lead. Under the phone number it says Mobile not confirmed.',
      'Choose Confirm it, then say how you reached them: called, met, or WhatsApp.',
    ],
    note: 'Only the person the lead is assigned to can confirm it — it records that you made contact. Editing the number afterwards clears the confirmation.',
  },
  {
    id: 'lead-products',
    title: 'Adding or changing products on a lead',
    permission: 'lead:update',
    area: 'Leads',
    steps: [
      'Open the lead. The product tags sit under the name.',
      'Choose Edit beside them, tick what they want, and save.',
    ],
    note: 'Do this when a client asks about something new mid-conversation. Until you do, the lead will not appear in filters or reports for that product.',
  },
  {
    id: 'product-outcome',
    title: 'Recording the outcome of one product',
    permission: 'lead:update',
    area: 'Leads',
    steps: [
      'Open the lead and find the Products panel. Open ones are listed first.',
      'Choose Change beside the product whose situation has moved.',
      'Pick the new stage. Lost asks for a reason; the others do not.',
      'Add a note if there is anything worth saying, then Record outcome.',
    ],
    note: "Each product closes on its own, so a client can take equity, still be considering F&O and have declined mutual funds. You never set the lead's own stage — it follows the products: the furthest-along one while anything is open, and once everything is closed, the best outcome reached. Somebody who bought equity and declined the rest reads as converted, not lost.",
  },
  {
    id: 'lead-profile',
    title: 'Recording the client profile',
    permission: 'lead:update',
    area: 'Leads',
    steps: [
      'Open the lead and find Additional information.',
      'Choose Add or Edit, fill in what you know, and save.',
    ],
    note: 'Leave blank anything you are unsure of. A guessed income is worse than an empty one, because it looks like a fact.',
  },
  {
    id: 'assign-lead',
    title: 'Assigning a lead',
    permission: 'lead:assign',
    area: 'Leads',
    steps: ['Open the lead, then Assign.', 'Choose the person. Suggestions appear based on the branch and workload.'],
  },
  {
    id: 'transfer-lead',
    title: 'Transferring a lead to another team',
    permission: 'lead:assign',
    area: 'Leads',
    steps: [
      'Open the lead and choose Transfer — a separate tab from Assign.',
      'Pick who takes it on. This list is wider than the Assign one and reaches outside your own team.',
      'Say why it is moving. A few words will not be accepted.',
      'Choose Transfer lead.',
    ],
    note: "Assign moves work inside your team; Transfer hands the lead somewhere else entirely, which is why the reason is required. It is written to the lead's timeline and the audit trail, so the next person to open it can see why they have it. Sales executives cannot transfer.",
  },
  {
    id: 'bulk-assign',
    title: 'Assigning leads in bulk',
    permission: 'lead:assign',
    area: 'Leads',
    steps: [
      'On the Leads list, tick the leads you want to move.',
      'Choose Assign and pick the person.',
    ],
    note: 'You can only assign to people within your own scope. If someone is missing from the list, they sit outside it.',
  },
  {
    id: 'duplicates',
    title: 'Merging duplicate leads',
    permission: 'lead:update',
    area: 'Leads',
    steps: [
      'Open Duplicates from the menu.',
      'Compare the two records, choose which to keep, and merge.',
    ],
    note: 'Never create a second lead for the same person. Their history splits in two and neither half tells the story.',
  },
  {
    id: 'close-lead',
    title: 'Moving a lead to Lost or Disqualified',
    permission: 'lead:update',
    area: 'Leads',
    steps: [
      'Open the lead, choose Change status.',
      'Pick Lost or Disqualified and give the reason.',
    ],
    note: 'Lost means we tried and failed. Disqualified means there was never anything to try — wrong number, not eligible. Either can be reopened if they come back.',
  },
  {
    id: 'convert',
    title: 'Converting a lead to a customer',
    permission: 'lead:convert',
    area: 'Leads',
    steps: [
      'Open the lead, then the Convert tab.',
      'Enter the PAN and confirm.',
    ],
    note: 'This is final — a converted lead cannot be moved back. It creates one customer carrying every product they were interested in.',
  },
  {
    id: 'documents',
    title: 'Attaching a client document',
    permission: 'lead:update',
    area: 'Leads',
    steps: [
      'Open the lead and find Documents.',
      'Choose the category, then attach the file.',
    ],
    note: 'PDFs and images up to 20 MB. Files are scanned before they can be downloaded again.',
  },
  {
    id: 'export-leads',
    title: 'Exporting leads',
    permission: 'lead:export',
    area: 'Leads',
    steps: ['Filter the Leads list to what you need.', 'Choose Export. Dates and times come out in the same format you see on screen.'],
    note: 'An export carries client contact details. Treat the file the way you would treat the client list itself.',
  },

  // ---- Conversations and tasks -------------------------------------------
  {
    id: 'log-interaction',
    title: 'Logging an interaction',
    permission: 'activity:create',
    area: 'Conversations and tasks',
    steps: [
      'Open the lead, then Log interaction.',
      'Say how it happened, what type it was, and write a short summary.',
      'Set the next follow-up before you save.',
    ],
    note: 'A call that is not logged did not happen, as far as anyone else can tell. Setting the follow-up is what stops a lead going quiet by accident.',
  },
  {
    id: 'expected-investment',
    title: 'Recording expected investment per product',
    permission: 'activity:create',
    area: 'Conversations and tasks',
    steps: [
      'While logging the interaction, tick the products you discussed.',
      'An amount box appears for each. Enter what you expect them to invest.',
    ],
    note: 'Your estimate, for the pipeline. Leave it blank if you have no idea — a blank and a zero mean different things.',
  },
  {
    id: 'dictate',
    title: 'Dictating a note in your own language',
    permission: 'activity:create',
    area: 'Conversations and tasks',
    steps: [
      'Tap Dictate beside Remarks, or beside the notes at visit check-out.',
      'Speak in whichever language you think in. Tap Stop when you are done.',
      'English text appears in the box. Edit it if anything came out wrong.',
    ],
    note: 'Recording stops itself after two minutes. If the button is greyed out, dictation has not been switched on yet.',
  },
  {
    id: 'create-task',
    title: 'Creating a task',
    permission: 'task:create',
    area: 'Conversations and tasks',
    steps: [
      'Setting a next follow-up while logging an interaction creates one for you.',
      'Or open Tasks and add one directly, with a due date and a priority.',
    ],
  },
  {
    id: 'update-task',
    title: 'Updating or completing a task',
    permission: 'task:update',
    area: 'Conversations and tasks',
    steps: [
      'Open Tasks and choose the one you want.',
      'Change the status, and add a note about what happened.',
    ],
    note: 'Statuses are managed by an administrator, so the list may differ from what you saw last month.',
  },

  // ---- Visits -------------------------------------------------------------
  {
    id: 'plan-visit',
    title: 'Planning a visit, and choosing the mode',
    permission: 'visit:create',
    area: 'Visits',
    steps: [
      'From the lead, choose Plan a field visit. Or Visits, then Plan a visit.',
      'Choose how it will happen: at the client, at our office, online, a call, or chat.',
      'Say what it is for, and when.',
    ],
    note: 'The mode decides what check-in asks for. A phone call will not ask you for a photo; a visit to a client will.',
  },
  {
    id: 'check-in',
    title: 'Checking in and out of a visit',
    permission: 'visit:create',
    area: 'Visits',
    steps: [
      'Open the visit when you arrive and allow location access.',
      'For a client visit, choose Open camera and take the photo in the app.',
      'When you leave, check out and write what was discussed.',
    ],
    note: 'Include your ID card and the premises in the frame, and do not photograph the client. Poor signal does not block you — the visit is recorded and marked unverified.',
  },
  {
    id: 'expenses',
    title: 'Claiming visit expenses',
    permission: 'visit:create',
    area: 'Visits',
    steps: [
      'Open the visit and find Expenses.',
      'Choose a category, enter the amount, and attach the receipt.',
    ],
    note: 'Only the person who made the visit can claim against it. Approval and payment happen in the back office, not here.',
  },
  {
    id: 'team-visits',
    title: 'Reviewing your team’s visits',
    permission: 'visit:read',
    area: 'Visits',
    steps: [
      'Open Visits. You see every visit within your scope.',
      'Visits flagged Needs review have something worth a look — no location recorded, or an imprecise one.',
    ],
    note: 'Those flags are observations about the evidence, not accusations. A rep in a basement gets flagged through no fault of their own; a pattern across weeks is what means something.',
  },

  // ---- Reporting ----------------------------------------------------------
  {
    id: 'lead-score',
    title: 'How a lead score is worked out',
    permission: 'lead:read',
    area: 'Leads',
    steps: [
      'Open any lead. The score sits beside the name, and tapping it lists every factor that produced it.',
      'Nothing is hidden — the list adds up to the number.',
    ],
    note:
      'Out of 100, built from: where the lead came from (a referral is worth 22, an imported list 2); ' +
      'which products they want, capped at 20 so ticking every box cannot inflate it; how reachable ' +
      'they are (PAN 10, email 6, city 3); how much you have spoken to them, on a curve, because five ' +
      'calls is not five times one call; a campaign attribution, 4; and the estimated value, on a log ' +
      'scale so one large figure cannot dominate. Then it decays: after seven quiet days it loses ' +
      'roughly 0.8 a day, down to 25, and a lead contacted within 48 hours gains 6. A score that fell ' +
      'overnight usually means nothing happened, not that the lead got worse.',
  },
  {
    id: 'score-bands',
    title: 'What Cold, Warm and Hot mean',
    permission: 'lead:read',
    area: 'Leads',
    steps: [
      'The band is the score, banded. Nothing else feeds it.',
      'Hot is 70 and above. Warm is 40 to 69. Cold is below 40.',
    ],
    note:
      'Because decay is part of the score, a lead slides from Hot to Warm on its own if it is left ' +
      'alone — the band is as much a measure of your attention as of the client. Nobody sets it by ' +
      'hand, and it cannot be overridden: to move a lead up, do something with it.',
  },
  {
    id: 'my-rating',
    title: 'How your rating is worked out',
    permission: 'analytics:sales:read',
    area: 'Reporting',
    steps: [
      'My performance shows the rating, both halves that make it, and every metric underneath.',
      'The coaching notes name the weakest metric rather than the score.',
    ],
    note:
      'Two parts: outcomes 55 per cent, behaviour 45. Behaviour is weighted that heavily on purpose — ' +
      'it is the part you control. It covers speed of first contact, follow-ups scheduled, follow-ups ' +
      'kept on time, interactions logged, and lost reasons recorded.',
  },
  {
    id: 'my-rating-fairness',
    title: 'Why your rating does not just count conversions',
    permission: 'analytics:sales:read',
    area: 'Reporting',
    steps: [
      'Open My performance and read the outcome half.',
      'It compares what you converted against what your leads were expected to convert.',
    ],
    note:
      'Every lead carries an expected conversion rate from its score when it reached you. Someone ' +
      'handed weak leads is measured against weak leads, so a good month on a poor book still reads ' +
      'as a good month. Ratings are also pulled toward the average when there is little to go on, ' +
      'which is why the panel marks confidence Low under 15 leads and High at 40 or more — a single ' +
      'lucky conversion in a thin month does not make anyone exceptional. Bands: Exceptional 80+, ' +
      'Strong 62, On track 45, Developing below that.',
  },
  {
    id: 'my-performance',
    title: 'Checking your own performance',
    permission: 'analytics:sales:read',
    area: 'Reporting',
    steps: ['Open My performance from the menu.', 'You see your leads, conversions and activity against any target set for you.'],
  },
  {
    id: 'management-performance',
    title: 'Checking company-wide performance',
    permission: 'analytics:management:read',
    area: 'Reporting',
    steps: ['Open the Dashboard for the company view.'],
    note: 'Roll-ups by branch, region and zone are not built yet. Today you can see an individual’s figures, not an org unit’s.',
  },
  {
    id: 'partner-business',
    title: 'Your partner business',
    permission: 'analytics:partner:read',
    area: 'Reporting',
    steps: ['Open My business from the menu.', 'You see the leads you referred and what became of them.'],
  },

  // ---- Administration -----------------------------------------------------
  {
    id: 'add-user',
    title: 'Adding a user and assigning a role',
    permission: 'user:create',
    area: 'Administration',
    steps: [
      'Users, then New user.',
      'Choose whether it is a SIHL employee or an associate partner.',
      'Enter the name — the email fills in for staff. Pick the designation, roles and reporting line.',
      'Issue credentials from the user’s page once created.',
    ],
    note: 'Partners need their back-office code, like R0018, and their own email address. Staff get an @sihl.in address and a SIHL- code generated for them.',
  },
  {
    id: 'org-units',
    title: 'Adding a branch, region or zone',
    permission: 'system:configure',
    area: 'Administration',
    steps: ['Branches and regions, then add the unit.', 'Choose its type and its parent in the hierarchy.'],
    note: 'Data scope follows this tree. A branch in the wrong place means the wrong people see those leads.',
  },
  {
    id: 'products',
    title: 'Adding products and sub-products',
    permission: 'system:configure',
    area: 'Administration',
    steps: [
      'Sources and products, then the Products tab.',
      'To add a sub-product, choose its parent under Sits under.',
    ],
    note: 'Two levels only. What you write here is what a salesperson reads out to a client.',
  },
  {
    id: 'task-statuses',
    title: 'Adding or retiring a task status',
    permission: 'system:configure',
    area: 'Administration',
    steps: ['Open the task status master and add one, choosing which category it behaves as.'],
    note: 'A status in use cannot be deleted — switch it off instead, so historical tasks still read correctly.',
  },
  {
    id: 'audit',
    title: 'Reading the audit trail',
    permission: 'audit:read',
    area: 'Administration',
    steps: ['Open Audit trail and filter by person, record or date.'],
    note: 'It records who changed what and when. Nothing in it can be edited or removed.',
  },
];

/** The topics a given person can act on. Same rule the navigation uses. */
export function visibleHelpTopics(permissions: readonly string[]): HelpTopic[] {
  return HELP_TOPICS.filter(
    (topic) => topic.permission === null || permissions.includes(topic.permission),
  );
}
