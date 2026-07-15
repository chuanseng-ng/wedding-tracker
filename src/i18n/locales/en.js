// English message catalog (source of truth). Keys are shared by every locale;
// zh-TW.js must mirror this exact key set (enforced by i18n.test.js).
// Interpolation uses {var}; *_one / *_other are singular/plural variants.
export default {
  // ── Shared ──────────────────────────────────────────────────────────────
  "common.selectOne": "Select one…",
  "common.optional": "(optional)",
  "common.language": "Language",

  // ── Wedding page ────────────────────────────────────────────────────────
  "wedding.docTitle": "{bride} & {groom} · Wedding",
  "wedding.notFound.title": "Page not found",
  "wedding.notFound.body": "This wedding page doesn't exist or hasn't been set up yet.",
  "wedding.previewBanner": "Preview — this page isn't published yet. Only you can see this link.",
  "wedding.inviteTag": "✦ {groom} & {bride} invite you ✦",
  "wedding.inviteTagFallback": "— — — You are cordially invited — — —",
  "wedding.rsvpNow": "RSVP Now",
  "wedding.loading": "Loading wedding page",
  "wedding.rsvpHint": "Use the personal link in your invitation for a faster experience",

  "wedding.countdown.today": "Today! 🎊",
  "wedding.countdown.toGo_one": "{n} day to go",
  "wedding.countdown.toGo_other": "{n} days to go",
  "wedding.countdown.ago_one": "{n} day ago",
  "wedding.countdown.ago_other": "{n} days ago",

  "wedding.story.eyebrow": "Our Story",
  "wedding.story.title": "How it all began",
  "wedding.funfacts.eyebrow": "Fun Facts",
  "wedding.funfacts.title": "A little about us",
  "wedding.bigday.eyebrow": "The Big Day",
  "wedding.bigday.title": "Event details",
  "wedding.gettingthere.eyebrow": "Getting There",
  "wedding.gettingthere.title": "Plan your journey",
  "wedding.join.eyebrow": "Join Us",
  "wedding.join.title": "Hope to see you there!",

  "wedding.timeline.tea": "Tea Ceremony",
  "wedding.timeline.solemnisation": "Solemnisation",
  "wedding.timeline.brunch": "Brunch Reception",
  "wedding.timeline.lunch": "Lunch Reception",
  "wedding.timeline.dinner": "Dinner Reception",
  "wedding.timeline.venue": "Venue",

  "wedding.dressCodeLabel": "Dress code:",
  "wedding.openMaps": "Open in Google Maps ↗",
  "wedding.rsvpBy": "Kindly RSVP by {date}",
  "wedding.ctaWaiting": "{couple} are waiting for your RSVP →",

  // Guest photowall (#138)
  "wedding.photowall.eyebrow": "Photo Wall",
  "wedding.photowall.title": "Moments from our guests",
  "wedding.photowall.empty": "No photos yet — be the first to share one!",
  "wedding.photowall.addPhoto": "Share a photo",
  "wedding.photowall.pinLabel": "Photowall PIN",
  "wedding.photowall.pinPlaceholder": "PIN from the invitation",
  "wedding.photowall.nameLabel": "Your name",
  "wedding.photowall.captionLabel": "Caption",
  "wedding.photowall.optional": "Optional",
  "wedding.photowall.submit": "Share photo",
  "wedding.photowall.preparing": "Preparing photo…",
  "wedding.photowall.uploading": "Uploading…",
  "wedding.photowall.success": "Thank you! Your photo is on the wall 🎉",
  "wedding.photowall.demoNotice": "Demo mode — photo sharing is disabled.",
  "wedding.photowall.sharedBy": "shared by {name}",
  "wedding.photowall.err.pinInvalid": "That PIN doesn't match — please check your invitation.",
  "wedding.photowall.err.tooManyAttempts": "Too many attempts — please try again in a few minutes.",
  "wedding.photowall.err.disabled": "Photo sharing isn't open right now.",
  "wedding.photowall.err.full": "The photo wall is full — thank you all!",
  "wedding.photowall.err.tooLarge": "That photo is too large to upload.",
  "wedding.photowall.err.badType": "Please choose a JPG, PNG, or WebP photo.",
  "wedding.photowall.err.unsupported": "Your browser can't read this photo format — please try a different photo.",
  "wedding.photowall.err.uploadFailed": "The upload didn't finish — please try again.",
  "wedding.photowall.err.generic": "Something went wrong — please try again.",

  // Fun-fact fallback questions (used only when the couple didn't supply their own)
  "wedding.funq.meet": "How did you two meet?",
  "wedding.funq.proposal": "How did the proposal happen?",
  "wedding.funq.iloveyou": "Who said 'I love you' first?",
  "wedding.funq.cook": "Who's the better cook?",
  "wedding.funq.funnier": "Who's funnier?",
  "wedding.funq.fiercer": "Who's fiercer?",
  "wedding.funq.memory": "What's your favourite memory together?",
  "wedding.funq.firstdate": "What happened on your first date?",

  // ── RSVP page ───────────────────────────────────────────────────────────
  "rsvp.docTitle": "RSVP · {bride} & {groom}'s Wedding",
  "rsvp.invited": "You're Invited",
  "rsvp.eyebrow": "RSVP",
  "rsvp.loading": "Loading your details…",
  "rsvp.configError": "Could not load event details — please try refreshing.",
  "rsvp.demoBadge": "Demo Mode",

  "rsvp.name.label": "Your Full Name",
  "rsvp.name.placeholder": "As written on your invitation",
  "rsvp.name.searchPlaceholder": "Start typing your name…",
  "rsvp.name.clearAria": "Clear name selection",
  "rsvp.searching": "Searching…",
  "rsvp.noMatch": "No match found — check spelling or contact the couple",

  // Open RSVP self-registration (#126)
  "rsvp.pin.label": "RSVP PIN",
  "rsvp.pin.placeholder": "The PIN from your invitation",

  "rsvp.email.label": "Your Email",
  "rsvp.email.placeholder": "So we can send your confirmation",

  "rsvp.attending.q": "Will you be attending?",
  "rsvp.attending.yes": "✓ Yes, I'll be there!",
  "rsvp.attending.no": "✗ Sorry, I can't make it",

  "rsvp.smart.title": "Which events will you join?",
  "rsvp.smart.hint": "Let us know for each guest in your party.",
  "rsvp.smart.you": "You",

  "rsvp.rel.q": "How do you know the couple?",
  "rsvp.friend.q": "Which kind of friend?",
  "rsvp.closerTo": "Closer to",
  "rsvp.side.brideFallback": "Bride",
  "rsvp.side.groomFallback": "Groom",

  "rsvp.meal.label": "Meal Choice",
  "rsvp.dietary.label": "Dietary Requirements",
  "rsvp.dietary.placeholder": "Any allergies or dietary needs?",

  "rsvp.speech.q": "Would you like to give a speech?",
  "rsvp.speech.yes": "🎤 Yes, I'd love to",
  "rsvp.speech.no": "No, thanks",

  "rsvp.plus.q": "Bringing additional guests?",
  "rsvp.plus.justMe": "Just me",
  "rsvp.plus.more_one": "{n} more guest",
  "rsvp.plus.more_other": "{n} more guests",
  "rsvp.plus.namePlaceholder": "Guest {i} full name",
  "rsvp.plus.disclaimer": "⚠️ Please inform the bride & groom of this addition.",

  "rsvp.notes.title": "Note to guests",
  "rsvp.notes.parking": "🅿️ Parking:",
  "rsvp.notes.smoking": "🚭 Smoking:",

  "rsvp.message.label": "Message to the Couple",
  "rsvp.message.placeholder": "Write a message or well wishes…",

  "rsvp.submit": "Confirm My RSVP",
  "rsvp.submitting": "Sending…",

  // Meal options (labels only — stored values stay in English)
  "rsvp.meal.Halal": "Halal",
  "rsvp.meal.Vegetarian": "Vegetarian",
  "rsvp.meal.Normal": "Normal",

  // Relationship options
  "rsvp.rel.family": "Family",
  "rsvp.rel.colleagues": "Colleagues",
  "rsvp.rel.friends": "Friends",
  "rsvp.rel.other": "Other",
  "rsvp.rel.complicated": "It's complicated 😅",

  // Friend subgroup options
  "rsvp.friend.army": "Army / NS",
  "rsvp.friend.primary_school": "Primary School",
  "rsvp.friend.secondary_school": "Secondary School",
  "rsvp.friend.tertiary": "JC / Poly",
  "rsvp.friend.university": "University",
  "rsvp.friend.other": "Other",
  "rsvp.friend.secret": "😏 It's a secret",

  // Confirmation view
  "rsvp.confirm.coupleFallback": "the couple",
  "rsvp.confirm.eventTitleFallback": "Wedding",
  "rsvp.confirm.seeYou": "See you there!",
  "rsvp.confirm.miss": "We'll miss you!",
  "rsvp.confirm.yesMsg": "Your RSVP is confirmed. {couple} can't wait to celebrate with you.",
  "rsvp.confirm.noMsg": "Thanks for letting us know. {couple} will miss you.",
  "rsvp.confirm.addToCalendar": "Add to Calendar",

  // Errors
  "rsvp.err.nameSelect": "Please type your name above and select it from the list.",
  "rsvp.err.nameEnter": "Please enter your name.",
  "rsvp.err.attendingSelect": "Please select whether you'll be attending.",
  "rsvp.err.answerAllEvents": "Please answer yes or no for each event.",
  "rsvp.err.emailInvalid": "Please enter a valid email address.",
  "rsvp.err.pinRequired": "Please enter the RSVP PIN from your invitation.",
  "rsvp.err.pinInvalid": "That PIN doesn't match — please check your invitation.",
  "rsvp.err.tooManyAttempts": "Too many PIN attempts — please try again in a little while.",
  "rsvp.err.notSetup": "RSVP is not set up yet — the database migration hasn't been run. Contact the couple.",
  "rsvp.err.linkExpired": "Your RSVP link has expired. Please contact the couple for a new link.",
  "rsvp.err.generic": "Something went wrong — please try again or contact the couple.",

  // Public runsheet page (#121)
  "runsheet.subtitle": "Wedding Day Runsheet",
  "runsheet.loading": "Loading…",
  "runsheet.notAvailable": "This runsheet is not available.",
  "runsheet.empty": "No runsheet items yet",
  "runsheet.view.list": "List",
  "runsheet.view.gantt": "Timeline",
  "runsheet.unscheduled": "Unscheduled",
  "runsheet.ganttEmpty": "Nothing scheduled yet.",
  "runsheet.durationMins": "{n} min",
};
