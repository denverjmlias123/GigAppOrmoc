export const strings = {
  common: {
    loading: 'Loading...',
    save: 'Save',
    cancel: 'Cancel',
    back: '← Back',
    retry: 'Try Again',
    errorTitle: 'Something went wrong',
  },
  modes: {
    findWork: 'Find Work',
    hire: 'Hire Someone',
    findWorkDesc: 'Browse local gigs in Ormoc, send proposals, and earn with your skills.',
    hireDesc: 'Post gigs, review local applicants, and hire skilled freelancers in Ormoc City.',
    switchNote: 'You can switch later, but only under certain conditions.',
  },
  onboarding: {
    skillsTitle: 'Select Your Skills',
    skillsSubtitle: 'Highlight what services you offer to help clients discover you.',
    yourSkillsTrayLabel: 'Your skills',
    yourSkillsEmptyHint: 'No skills selected yet. Pick from the catalog, use AI suggestions, or type a custom skill below.',
    saveSkillsBtn: 'Save Skills',
    savingSkillsText: 'Saving skills...',
    skillsSavedText: 'Saved',
    pendingReviewBadge: 'Pending review',
    zeroSkillsWarning: 'You need at least 1 skill to apply for gigs',
    aiSkillsPlaceholder: 'What kind of work do you do? (e.g. aircon repair, math tutor, delivery)',
    suggestSkillsBtn: '✨ Suggest skills',
    suggestingSkills: 'Thinking of skills...',
    addCustomSkillPlaceholder: 'Type a custom skill name (2–40 chars)...',
    addCustomSkillBtn: 'Add Skill',
    hiringTitle: 'What do you usually need help with?',
    hiringSubtitle: 'Tell local freelancers in Ormoc what kind of projects or services you look for.',
    aiCategoriesPlaceholder: 'Describe what you usually need help with (e.g. aircon cleaning, errands, graphic design)',
    suggestCategoriesBtn: '✨ Suggest categories',
    suggestingCategories: 'Thinking of categories...',
    addCustomCategoryPlaceholder: 'Type a custom category...',
    addCustomCategoryBtn: 'Add Category',
    bioTitle: 'Introduce Yourself',
    bioSubtitle: 'Tell clients and collaborators in Ormoc a little bit about what you do.',
    helpMeWriteBioBtn: '✨ Help me write this',
    draftingBio: 'Drafting bio options...',
    bioDraftsTitle: 'Suggested Drafts (Tap to use)',
    finishSetupBtn: 'Finish Setup',
    skipForNow: 'Skip for now',
  },
  auth: {
    loginTitle: 'Welcome Back',
    loginSubtitle: 'Log in to your Gigormoc account',
    loginNameFallback: 'there',
    loginBackLabel: 'Go back',
    loginEmailLabel: 'Username or Email',
    loginEmailPlaceholder: 'Enter your username or email',
    loginPasswordLabel: 'Password',
    loginPasswordPlaceholder: 'Your password',
    forgotPassword: 'Forgot password?',
    loginOffline: 'Offline — Check Connection',
    loginButton: 'Log in',
    loginResendSending: 'Sending...',
    loginResendConfirmation: 'Resend confirmation email',
    loginNewAccount: 'New to Gigormoc?',
    loginCreateAccount: 'Create an account',
    loginReturnSubtitle: 'Log in to pick up where you left off.',
    loginProfileUnavailable: 'We could not load your profile. Please try again.',
    loginAccountNotFound: 'No account found for this email. Create one?',
    loginLocked: 'Too many failed attempts. Try again in',
    loginAttemptsLeft: (count: number) => `${count} attempts remaining.`,
    loginAttemptsLeftCount: (count: number) => `${count} attempts remaining before a temporary lock.`,
    loginLockoutEnded: 'You can try logging in again now.',
    signupTitle: 'Create Account',
    step1Title: 'Account Details',
    step2Title: 'Age Confirmation',
    step2Subtitle:
      'Gigormoc is strictly for adults aged 18 and older. Your birth date is kept strictly confidential and is never shown publicly.',
    forgotPasswordTitle: 'Reset Password',
    duplicateEmailMessage: 'This email is already registered. Log in or reset your password.',
    duplicateEmailLoginBtn: 'Log in',
    duplicateEmailResetBtn: 'Reset password',
    invalidEmailFormat: 'Please enter a valid email address.',
    disposableEmailTypo: 'Please check your email domain for typos (for example, @gmail.com or @yahoo.com).',
    loginSuccess: (name: string) => `Login successful. Welcome, ${name}.`,
    passwordShow: 'Show password',
    passwordHide: 'Hide password',
    signupDisplayNameLabel: 'Display name',
    signupDisplayNamePlaceholder: 'e.g. Maria Santos',
    signupDisplayNameRequired: 'Please enter your display name (at least 2 characters).',
    signupEmailLabel: 'Email or username',
    signupEmailPlaceholder: 'you@example.com or any ID',
    signupPasswordLabel: 'Password',
    signupConfirmPasswordLabel: 'Confirm password',
    signupConfirmPasswordPlaceholder: 'Repeat password',
    signupTermsRequired: 'You must accept the Terms of Service and Privacy Notice.',
    signupTermsLabel: 'I accept the Terms of Service and Privacy Notice, and confirm I am at least 18 years old.',
    signupContinue: 'Continue to Step 2',
    signupStep1Indicator: 'Step 1 of 2',
    signupStep2Indicator: 'Step 2 of 2',
    signupAlreadyAccount: 'Already have an account?',
    signupComplete: 'Complete registration',
    signupBackToStep1: 'Back to Step 1',
    dateOfBirthLabel: 'Date of birth',
    dateOfBirthPlaceholder: 'Select your date of birth',
    dateOfBirthHint: 'Choose your birth date. You must be at least 18 years old to register.',
    dateOfBirthPickerTitle: 'Select date of birth',
    dateOfBirthInvalid: 'Please choose a valid date of birth.',
    dateOfBirthUnder18: 'You must be at least 18 years old to register for Gigormoc.',
    loginEmailRequired: 'Please enter your email address.',
    loginPasswordRequired: 'Please enter your password.',
    loginResendEmailRequired: 'Please enter your email address first.',
    confirmationEmailSent: (email: string) => `Confirmation email sent to ${email}. Please check your inbox.`,
    logoutConfirmTitle: 'Are you sure you want to logout?',
    logoutConfirmMessage: 'You will need to log in again to use Gigormoc.',
    logoutConfirmYes: 'Yes, log out',
    logoutAllConfirmMessage: 'This will log out this device and revoke other active sessions.',
    logoutAllConfirmYes: 'Yes, log out everywhere',
    securitySettings: 'Password and security',
    changePassword: 'Change password',
    currentPassword: 'Current password',
    newPassword: 'New password',
    confirmNewPassword: 'Confirm new password',
    passwordPolicyTitle: 'Password requirements',
    passwordLengthRule: '8–72 characters',
    passwordLowercaseRule: 'One lowercase letter',
    passwordUppercaseRule: 'One uppercase letter',
    passwordNumberRule: 'One number',
    passwordSpecialRule: 'One special character',
    passwordNoSpacesRule: 'No spaces',
    passwordNotEmailRule: 'Must not match your email',
    passwordNotNameRule: 'Must not match your name',
    passwordStrengthLabel: 'Strength',
    passwordStrengthWeak: 'Weak',
    passwordStrengthFair: 'Fair',
    passwordStrengthStrong: 'Strong',
    passwordMismatch: 'Passwords do not match.',
    passwordInvalid: 'Please meet all password requirements.',
    passwordCurrentRequired: 'Enter your current password.',
    passwordCurrentIncorrect: 'Your current password is incorrect. Please try again.',
    passwordReauthCodeLabel: 'Email confirmation code',
    passwordReauthCodeSent: 'We sent a confirmation code to your email. Enter it to finish changing your password.',
    passwordReauthCodeRequired: 'Enter the confirmation code from your email.',
    passwordReauthCodeIncorrect: 'That confirmation code is invalid or expired. Request a new code and try again.',
    passwordReauthSendAgain: 'Send a new confirmation code',
    sessionsTitle: 'Active sessions',
    sessionsSubtitle: 'Review devices currently signed in to your account.',
    sessionsEmpty: 'No active sessions were found.',
    sessionsThisDevice: 'This device',
    sessionsLogOutOthers: 'Log out other devices',
    sessionsLogOutOthersConfirm: 'Other active sessions will be signed out. This device stays signed in.',
    sessionsLogOutOthersDone: (count: number) => count === 1 ? 'Signed out 1 other session.' : `Signed out ${count} other sessions.`,
    sessionsLastActive: (date: string) => `Last active ${date}`,
    sessionsEnded: 'Signed out',
    sessionsLoadFailed: 'Could not load your sessions. Check your connection and try again.',
    passwordResetReady: 'Set a new password for your account.',
    passwordResetSent: 'If an account matches that email, password reset instructions will be sent.',
    passwordResetDescription: 'Enter the email associated with your account and we will send password reset instructions.',
    passwordResetEmailLabel: 'Email address',
    passwordResetEmailPlaceholder: 'you@example.com',
    passwordResetSend: 'Send reset link',
    passwordResetSentTitle: 'Check your email',
    passwordResetReturnToLogin: 'Return to log in',
    passwordResetSendFailed: 'Could not send the reset email. Please try again.',
    otpCodeLabel: 'Verification code',
    otpPasteButton: 'Paste code',
    otpCopyButton: 'Copy code',
    otpVerifyButton: 'Verify code',
    otpVerifying: 'Verifying code...',
    otpCodeRequired: 'Please enter the verification code.',
    otpCodeLength: 'Please enter the complete 6-digit code.',
    otpResendIn: (seconds: number) => `Resend code in ${seconds}s`,
    otpResendNow: 'Resend code',
    otpCodeSentNotice: 'Your verification code is shown below. Copy it, then paste it above.',
    otpInvalidOrExpired: 'The verification code is incorrect or has expired. Request a new code.',
    otpConfirmedSuccess: 'Account confirmed.',
    otpDevTestNotice: 'Test account code generated:',
    otpDevCopyFillBtn: 'Tap to copy & fill code',
    otpCodeDisplayTitle: 'Your code',
    otpCodeInstructions: 'Copy the code below, then paste it into the box to verify your account.',
  },
  gigs: {
    availableGigs: 'Available Gigs',
    myGigs: 'My Posted Gigs',
    postGig: 'Post a Gig',
    postGigTitle: 'Create a New Gig',
    searchPlaceholder: 'Search gigs by title or keywords...',
    filterAll: 'All Work Types',
    filterRemote: 'Remote',
    filterFaceToFace: 'Face-to-face',
    filterHybrid: 'Hybrid',
    noGigsTitle: 'No open gigs available',
    noGigsDesc: 'No open gigs currently match these filters. Check back or refresh to see new posts.',
    noOpenClientGigsTitle: 'No open gigs waiting for applicants',
    noOpenClientGigsDesc: 'Publish a gig to receive proposals. Your hired, completed, and closed gigs are under My Gigs or Hired.',
    viewMyGigs: 'View My Gigs',
    noMyGigsTitle: "You haven't posted any gigs yet",
    noMyGigsDesc: 'Ready to find local talent in Ormoc? Post a gig with clear requirements and budget.',
    applyBtn: 'Apply for Gig',
    deadline: 'Deadline',
    applicationDeadline: 'Apply before',
    budget: 'Budget',
    requirements: 'Requirements',
    workType: 'Work Type',
    area: 'Location / Barangay',
    draftStatus: 'Draft',
    publishBtn: 'Publish Gig',
    publishDraftTitle: 'Publish this gig?',
    publishDraftMessage: 'This gig will be visible to freelancers who can browse and apply.',
    publishDraftConfirm: 'Publish Gig',
    publishDraftFailed: 'Could not publish this gig. Please try again.',
    completedReadOnlyTitle: 'This gig is completed',
    completedReadOnlyDesc: 'This gig is closed and remains in your history. You can still open its agreement and reviews.',
    closedReadOnlyTitle: 'This gig is closed',
    closedReadOnlyDesc: 'This gig is kept in your history and is no longer available for new proposals or changes.',
    gigUnavailableTitle: 'This gig is closed',
    gigUnavailable: 'This gig is no longer open to new proposals. If you already applied, check My Work for its status.',
    unavailableAgreementDesc: 'You have an agreement for this gig. Open it to view its current status and history.',
    openAgreement: 'Open Agreement',
    saveDraftBtn: 'Save Draft',
    cancelGigBtn: 'Cancel Gig',
    deleteGigBtn: 'Delete Gig',
    deleteGigTitle: 'Delete gig',
    deleteGigNoApplicantsMessage: 'Delete this gig? It will be removed from listings and cannot be restored.',
    deleteGigApplicantsOneMessage: '1 person has applied. They will be notified and their proposal will be closed. Delete this gig?',
    deleteGigApplicantsManyMessage: '{count} people have applied. They will be notified and their proposals will be closed. Delete this gig?',
    deleteGigConfirm: 'Delete gig',
    keepGig: 'Keep gig',
    deletingGig: 'Deleting…',
    deletedGigProposal: 'Gig deleted',
    deletedGigProposalDesc: 'The client deleted this gig. Your proposal is closed and can’t be changed.',
    alreadyHiredDeleteBlock: 'A freelancer is already hired. Cancel the agreement first before removing this gig.',
    categoryLabel: 'Category *',
    categoryHelper: 'Pick a suggested category, search existing categories, or create a general category if none fit.',
    suggestedCategoriesLabel: 'Suggested for your gig',
    aiSuggestCategoryBtn: '✨ Suggest best category',
    aiSuggestingCategory: 'Matching categories...',
    searchOrCreateCategoryPlaceholder: 'Search categories or type a new category name (3–40 chars)...',
    didYouMeanLabel: 'Did you mean an existing category?',
    createNewCategoryPrompt: 'No matching category? Create a new one:',
    confirmCreateNewCategoryPrefix: 'No, create',
    confirmCreateNewCategorySuffix: 'as a new category',
    addNewCategoryPrefix: 'Add',
    addNewCategorySuffix: 'as a new category',
    aiProposedCategoryLabel: 'AI suggested new category:',
    filterAllCategories: 'All Categories',
    hireModeRequiredTitle: 'Hire Someone Mode Required',
    hireModeRequiredDesc: 'You are currently in Find Work mode. Posting gigs is exclusively for clients in Hire Someone mode.',
    editGig: 'Edit Gig',
  },
  profile: {
    title: 'My Profile',
    editProfile: 'Edit Profile Details',
    manageSkills: 'Manage Skills',
    portfolio: 'Portfolio Items',
    viewPublic: 'View Public Profile',
    ratingLabel: 'Rating',
    completedGigsLabel: 'Gigs completed',
    profileCompleteBadge: 'Profile complete',
    completenessTitle: 'Profile completeness',
    completenessHint: 'Tap a missing item below to jump to it:',
    unsavedChangesTitle: 'Discard unsaved changes?',
    unsavedChangesBody: 'You have unsaved profile edits. Are you sure you want to leave without saving?',
    discardBtn: 'Discard',
    keepEditingBtn: 'Keep editing',
    privateFieldNote: 'Private — never shown on your public profile',
    photoSectionTitle: 'Profile Photo',
    chooseFromLibraryBtn: 'Choose from photos/files',
    takePhotoBtn: 'Take a photo',
    removePhotoBtn: 'Remove photo',
    languagesList: ['English', 'Tagalog', 'Bisaya', 'Waray', 'Other'] as const,
    workTypeOptions: [
      { value: 'remote', label: 'Remote' },
      { value: 'face_to_face', label: 'Face-to-face' },
      { value: 'hybrid', label: 'Hybrid' },
    ] as const,
    availabilityOptions: [
      { value: 'available_now', label: 'Available now' },
      { value: 'part_time', label: 'Part-time' },
      { value: 'weekends', label: 'Weekends' },
      { value: 'not_taking_work', label: 'Not taking work' },
    ] as const,
    experienceOptions: [
      { value: 'lt_1', label: 'Less than 1 year' },
      { value: '1_3', label: '1–3 years' },
      { value: '3_5', label: '3–5 years' },
      { value: '5_plus', label: '5+ years' },
    ] as const,
    clientTypeOptions: [
      { value: 'individual', label: 'Individual / Household' },
      { value: 'business', label: 'Small Business / Shop' },
      { value: 'organization', label: 'School / Organization' },
      { value: 'other', label: 'Other' },
    ] as const,
  },
  loop: {
    timelineTitle: 'Relationship Progress',
    youAreHereBadge: 'You are here',
    yourTurnBadge: 'Your turn to act',
    waitingBadge: 'Waiting on other side',
    openChatBtn: '💬 Open Chat',
    viewStageBtn: 'Go to Stage ›',
    stages: {
      posted: 'Posted',
      applied: 'Applied',
      accepted: 'Accepted',
      milestones_set: 'Milestones set',
      work_submitted: 'Work submitted',
      approved: 'Approved',
      payment_reported: 'Payment reported',
      payment_confirmed: 'Payment confirmed',
      done: 'Done',
      reviewed: 'Reviewed',
    },
  },
  admin: {
    logTitle: 'Log trail',
    logSubtitle: 'Review account and marketplace activity. This log cannot be edited or deleted.',
    logSearchLabel: 'Search logs',
    logUserLabel: 'User email or ID',
    logActionLabel: 'Action',
    logEntityLabel: 'Entity type',
    logFromLabel: 'From date and time',
    logToLabel: 'To date and time',
    logStatusLabel: 'Status',
    logAllStatus: 'All statuses',
    logSuccessStatus: 'Success',
    logFailureStatus: 'Failure',
    logApplyFilters: 'Apply filters',
    logClearFilters: 'Clear filters',
    logExport: 'Export filtered logs as CSV',
    logExporting: 'Preparing CSV...',
    logExportTitle: 'Gigormoc log trail CSV',
    logExportLimit: 'There are more than 10,000 matching events. Add filters before exporting.',
    logExportViewLimit: 'There are more than 1,000 matching log views. Narrow the date or user filter before exporting.',
    logExportFailed: 'Could not export these logs. Try again.',
    logExportReady: (count: number) => `CSV export prepared with ${count} events.`,
    logLoadFailed: 'Could not load the log trail. Check your access or connection and try again.',
    logAccessDenied: 'You do not have access to the admin log trail.',
    logEmpty: 'No log events match these filters.',
    logEvent: 'Log event',
    logActor: 'Actor',
    logEntity: 'Entity',
    logRole: 'Role',
    logEntityId: 'Entity ID',
    logOccurredAt: 'Occurred',
    logIp: 'IP address',
    logDevice: 'Device',
    logMetadata: 'Details',
    logPage: (page: number, pages: number, count: number) => `Page ${page} of ${pages} · ${count} events`,
    logPrevious: 'Previous page',
    logNext: 'Next page',
    logFilterBoundary: 'Check the date format and filter lengths, then try again.',
    logDatePlaceholder: 'Example: 2026-10-01T00:00:00Z',
    logNoValue: 'Not available',
    title: 'Administration', dashboard: 'Admin dashboard', users: 'User management',
    logTrail: 'Log trail', accessDenied: "You don't have access to administration.",
    retry: 'Retry', search: 'Search by name, email, or ID', createUser: 'Create user',
    name: 'Full name', email: 'Email', dob: 'Date of birth', area: 'Area',
    temporaryPassword: 'Temporary password', status: 'Account status', active: 'Active',
    suspended: 'Suspended', deleted: 'Deleted', findWork: 'Find Work', hire: 'Hire Someone',
    unselected: 'Mode not selected', noUsers: 'No users match these filters.',
    save: 'Save changes', resetPassword: 'Send password reset email', unlock: 'Reset login lockout',
    endSessions: 'End active sessions', role: 'Admin role', userRole: 'User', adminRole: 'Admin',
    superAdmin: 'Super admin', delete: 'Soft delete account', confirmEmail: 'Type this user’s email to confirm',
    deleteConfirm: 'Delete user', createTitle: 'Create account', userCount: 'Users',
    latestActivity: 'Latest activity', openReports: 'Open reports', lockedAccounts: 'Locked accounts',
    newUsers: 'New users (7 days)', activeGigs: 'Open gigs', inProgress: 'Agreements in progress',
    completed: 'Completed agreements', todayEvents: 'Log events today', noActivity: 'No recent admin activity.',
  },
  errors: {
    generic: 'Something went wrong. Please try again.',
    network: 'Network connection error. Please check your internet connection and try again.',
    unauthorized: 'Please log in to continue.',
    forbidden: 'You do not have permission to perform this action.',
    cooldownActive: 'Mode switch is currently on its 7-day cooldown.',
    invalidMilestoneSum: 'The sum of all milestone amounts must equal the agreed project price.',
    maxRevisionsReached: 'Maximum of 2 revisions has already been used for this milestone.',
    reviewWindowClosed: 'The 14-day review window for this agreement has closed.',
    offline: "You appear to be offline. Changes can't be saved until your connection returns.",
    timeout: 'The request took too long. Please check your connection and try again.',
    sessionExpired: 'Your session has expired. Please log in again to continue.',
    loggedOutNotice: 'You have been successfully logged out.',
    conflict: 'This was already updated. Showing the latest.',
    alreadyDoneOtherDevice: 'Already done on your other device.',
    rateLimited: 'Too many tries. Please wait a moment and try again.',
    notFound: 'The requested item could not be found or was removed.',
    serverError: 'Our server encountered a temporary issue. Please try again in a moment.',
    wrongCredentials: 'Incorrect email or password. Please check your credentials and try again.',
    emailNotConfirmed: 'Please confirm your email address before logging in.',
    accountSuspended: 'Your account is currently suspended or inactive. Please contact support.',
    wrongMode: 'This action requires switching your active mode in Settings.',
    uploadTooLarge: 'File is too large. Please choose a file under 5 MB.',
    uploadInvalidType: 'Unsupported file format. Please upload a JPG, PNG, or WebP image.',
    uploadPermissionDenied: 'Permission to access your files or photos was denied.',
    notificationReadFailed: 'Could not mark this notification as read. Please try again.',
    notificationCountLoadFailed: 'Could not load your notification count. Your gigs are still available below.',
    conversationReadFailed: 'Could not update the conversation read status. Please try again.',
    deletedConversationReadOnly: 'This conversation is read-only because the gig was deleted.',
    gigUnavailable: 'This gig is no longer available. Your proposal could not be submitted.',
    gigHasAgreement: 'A freelancer is already hired for this gig. Cancel the agreement first.',
    gigCompleted: 'Completed gigs remain available as history and cannot be deleted.',
    conversationClosed: 'This conversation is read-only because the gig was deleted.',
  },
  toasts: {
    adminSaved: 'User changes saved',
    adminCreated: 'User created. They must change the temporary password after signing in.',
    adminResetSent: 'Password reset email sent',
    adminDeleted: 'User account anonymized and deactivated',
    adminUnlocked: 'Login lockout cleared',
    passwordUpdated: 'Password updated',
    gigPublished: 'Gig published',
    gigDraftSaved: 'Draft saved',
    gigCancelled: 'Gig cancelled',
    gigDeleted: 'Gig deleted',
    gigDeletedOneApplicant: 'Gig deleted. 1 applicant was notified.',
    gigDeletedApplicants: 'Gig deleted. {count} applicants were notified.',
    applicationSent: 'Application sent',
    applicationAccepted: 'Application accepted',
    applicationDeclined: 'Application declined',
    counterSent: 'Counter-offer sent',
    counterAccepted: 'Counter-offer accepted',
    counterDeclined: 'Counter-offer declined',
    applicationWithdrawn: 'Application withdrawn',
    milestonesSaved: 'Milestones saved',
    workSubmitted: 'Work submitted',
    milestoneApproved: 'Milestone approved',
    revisionRequested: 'Revision requested',
    paymentReported: 'Payment reported',
    paymentConfirmed: 'Payment confirmed',
    paymentDisputed: 'Payment disputed',
    agreementCompleted: 'Agreement completed',
    agreementCancelled: 'Agreement cancelled',
    reviewPosted: 'Review posted',
    messageSent: 'Message sent',
    profileSaved: 'Profile saved',
    skillsSaved: 'Skills saved',
    hiringDetailsSaved: 'Hiring preferences saved',
    photoUpdated: 'Photo saved',
    photoRemoved: 'Photo removed',
    portfolioAdded: 'Portfolio item added',
    portfolioRemoved: 'Portfolio item removed',
    modeSwitched: 'Mode switched',
    reportSubmitted: 'Report submitted',
  },
};

/**
 * Maps raw Postgres / Supabase RPC, Auth, Network, or Storage errors to friendly user-facing messages
 * from constants/strings.ts while preserving explicit human-readable validation messages.
 */
export function mapSqlErrorToFriendlyMessage(
  err: unknown,
  fallback: string = strings.errors.generic
): string {
  if (!err) return fallback;
  const rawMessage =
    typeof err === 'string'
      ? err
      : typeof (err as any)?.message === 'string'
      ? (err as any).message
      : '';
  const code = typeof (err as any)?.code === 'string' ? (err as any).code : '';
  const status = typeof (err as any)?.status === 'number' ? (err as any).status : 0;
  const name = typeof (err as any)?.name === 'string' ? (err as any).name : '';
  const lower = rawMessage.toLowerCase();

  if (lower.includes('gig_unavailable')) return strings.errors.gigUnavailable;
  if (lower.includes('gig_has_agreement')) return strings.errors.gigHasAgreement;
  if (lower.includes('gig_completed')) return strings.errors.gigCompleted;
  if (lower.includes('conversation_closed')) return strings.errors.conversationClosed;

  if (code.toLowerCase() === 'weak_password' || lower.includes('weak password')) {
    return strings.auth.passwordInvalid;
  }

  // 1. Offline / Network
  if (
    lower.includes('failed to fetch') ||
    lower.includes('network request failed') ||
    lower.includes('networkerror') ||
    lower.includes('offline') ||
    lower.includes('internet connection')
  ) {
    return strings.errors.network;
  }

  // 2. Timeout / Abort
  if (
    name === 'AbortError' ||
    code === 'ETIMEDOUT' ||
    code === '57014' ||
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('aborted')
  ) {
    return strings.errors.timeout;
  }

  // 3. Auth / Session Expired / 401
  if (
    status === 401 ||
    code === 'PGRST301' ||
    lower.includes('jwt expired') ||
    lower.includes('invalid jwt') ||
    lower.includes('refresh_token_not_found') ||
    lower.includes('session_not_found') ||
    lower.includes('session expired')
  ) {
    return strings.errors.sessionExpired;
  }

  if (lower.includes('not authenticated') || lower.includes('authentication required')) {
    return strings.errors.unauthorized;
  }

  if (
    lower.includes('invalid login credentials') ||
    lower.includes('invalid_credentials') ||
    lower.includes('wrong password')
  ) {
    return strings.errors.wrongCredentials;
  }

  if (lower.includes('email not confirmed') || code === 'email_not_confirmed') {
    return strings.errors.emailNotConfirmed;
  }

  // 4. Rate limit / 429
  if (
    status === 429 ||
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('too many attempts') ||
    lower.includes('for security purposes, you can only request this after')
  ) {
    const waitMatch = rawMessage.match(/(\d+)\s*second/i);
    if (waitMatch) {
      return `Too many tries. Please wait ${waitMatch[1]} seconds.`;
    }
    return strings.errors.rateLimited;
  }

  // 5. Account suspended / Mode / Forbidden
  if (
    lower.includes('account is not active') ||
    lower.includes('suspended') ||
    lower.includes('deactivated')
  ) {
    return strings.errors.accountSuspended;
  }

  if (
    lower.includes('must be in hire') ||
    lower.includes('must be in find work') ||
    lower.includes('only be added in find work') ||
    lower.includes('only be modified in find work') ||
    lower.includes('only be saved in hire')
  ) {
    return rawMessage || strings.errors.wrongMode;
  }

  if (
    status === 403 ||
    code === '42501' ||
    lower.includes('row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('access denied')
  ) {
    return strings.errors.forbidden;
  }

  // 6. Not found
  if (
    status === 404 ||
    code === 'PGRST116' ||
    lower.includes('not found') ||
    lower.includes('no rows')
  ) {
    return rawMessage && !rawMessage.includes('PGRST') ? rawMessage : strings.errors.notFound;
  }

  // 7. Conflict / Duplicate / Stale state
  if (lower.includes('already_done') || lower.includes('already done on your other device')) {
    return strings.errors.alreadyDoneOtherDevice;
  }

  if (
    status === 409 ||
    code === '23505' ||
    lower.includes('duplicate key value') ||
    lower.includes('unique constraint') ||
    lower.includes('already updated')
  ) {
    return strings.errors.conflict;
  }

  // 8. Storage upload errors
  if (lower.includes('payload too large') || lower.includes('exceeded the maximum allowed size') || lower.includes('5mb') || lower.includes('5 mb')) {
    return strings.errors.uploadTooLarge;
  }
  if (lower.includes('mime type') || lower.includes('invalid_mime_type') || lower.includes('unsupported file')) {
    return strings.errors.uploadInvalidType;
  }

  // 9. Domain rules
  if (lower.includes('cooldown')) {
    return rawMessage || strings.errors.cooldownActive;
  }
  if (lower.includes('milestone') && lower.includes('sum')) {
    return rawMessage || strings.errors.invalidMilestoneSum;
  }
  if (lower.includes('revision') && lower.includes('max')) {
    return rawMessage || strings.errors.maxRevisionsReached;
  }
  if (lower.includes('14') && lower.includes('review')) {
    return rawMessage || strings.errors.reviewWindowClosed;
  }

  // 10. Server / raw SQL sanitization (never leak PGRST*, SQLSTATE codes, or syntax error text)
  if (
    status >= 500 ||
    /^PGRST\d+/i.test(code) ||
    /^(22|23|42|53|54|55|57|58|XX)\w{3}$/i.test(code) ||
    lower.includes('syntax error at or near') ||
    lower.includes('relation "') ||
    lower.includes('column "') ||
    lower.includes('internal server error')
  ) {
    return strings.errors.serverError;
  }

  return rawMessage.trim() || fallback;
}


