// OWNER: find agent. Words people actually use for the district's essential medicines and the places they live.
// Names, brand names, Hindi spellings, common conditions. Village names are SYNTHETIC and fictional.

export type ConditionId = "sugar" | "bp" | "fever" | "iron" | "diarrhoea" | "infection" | "breathing";

export type MedicineWords = {
  hi: string; // Hindi display name
  plainHi: string; // what it is for, in plain Hindi
  plainEn: string;
  aliases: string[]; // names, brands, spellings (Latin and Devanagari)
  conditions: ConditionId[];
};

export const MEDICINE_WORDS: Record<string, MedicineWords> = {
  "metformin-500": {
    hi: "मेटफॉर्मिन", plainHi: "शुगर की दवा", plainEn: "for sugar (diabetes)",
    aliases: ["metformin", "मेटफॉर्मिन", "मेटफार्मिन", "glycomet", "glucophage", "ग्लाइकोमेट", "metformin 500"],
    conditions: ["sugar"],
  },
  "glimepiride-2": {
    hi: "ग्लिमेपिराइड", plainHi: "शुगर की दवा", plainEn: "for sugar (diabetes)",
    aliases: ["glimepiride", "ग्लिमेपिराइड", "ग्लिमिपिराइड", "amaryl", "glimy", "glimer"],
    conditions: ["sugar"],
  },
  "amlodipine-5": {
    hi: "एम्लोडिपिन", plainHi: "BP की दवा", plainEn: "for blood pressure",
    aliases: ["amlodipine", "एम्लोडिपिन", "अम्लोडिपिन", "एमलोडिपीन", "amlong", "amlopres", "stamlo"],
    conditions: ["bp"],
  },
  "telmisartan-40": {
    hi: "टेल्मिसार्टन", plainHi: "BP की दवा", plainEn: "for blood pressure",
    aliases: ["telmisartan", "टेल्मिसार्टन", "टेलमिसारटन", "telma", "telmikind", "टेल्मा"],
    conditions: ["bp"],
  },
  "atenolol-50": {
    hi: "एटेनोलोल", plainHi: "BP और दिल की दवा", plainEn: "for blood pressure and heart",
    aliases: ["atenolol", "एटेनोलोल", "अटेनोलोल", "aten", "tenormin"],
    conditions: ["bp"],
  },
  "ifa-tablets": {
    hi: "आयरन फोलिक एसिड", plainHi: "खून की कमी, गर्भावस्था", plainEn: "for anaemia and pregnancy",
    aliases: ["ifa", "iron", "iron folic acid", "folic acid", "आयरन", "आइरन", "आयरन की गोली", "लाल गोली", "फोलिक", "आईएफए"],
    conditions: ["iron"],
  },
  "amoxicillin-500": {
    hi: "अमोक्सीसिलिन", plainHi: "संक्रमण (एंटीबायोटिक)", plainEn: "antibiotic for infections",
    aliases: ["amoxicillin", "amoxycillin", "amoxy", "mox", "novamox", "अमोक्सीसिलिन", "अमोक्सिसिलिन", "एमोक्सिसिलिन", "मोक्स"],
    conditions: ["infection"],
  },
  "paracetamol-500": {
    hi: "पैरासिटामोल", plainHi: "बुखार और दर्द", plainEn: "for fever and pain",
    aliases: ["paracetamol", "पैरासिटामोल", "पेरासिटामोल", "पैरासीटामोल", "crocin", "dolo", "calpol", "pcm", "क्रोसिन", "डोलो", "acetaminophen"],
    conditions: ["fever"],
  },
  "ors-sachet": {
    hi: "ओआरएस घोल", plainHi: "दस्त, पानी की कमी", plainEn: "for diarrhoea and dehydration",
    aliases: ["ors", "ओआरएस", "ओ आर एस", "electral", "इलेक्ट्रल", "घोल", "जीवन रक्षक घोल"],
    conditions: ["diarrhoea"],
  },
  "salbutamol-inhaler": {
    hi: "सालबुटामोल इनहेलर", plainHi: "दमा, साँस", plainEn: "inhaler for asthma",
    aliases: ["salbutamol", "सालबुटामोल", "साल्बुटामोल", "asthalin", "अस्थालिन", "inhaler", "इनहेलर", "पंप", "pump", "salbutamol inhaler"],
    conditions: ["breathing"],
  },
};

export type ConditionWords = { id: ConditionId; hi: string; en: string; aliases: string[] };

export const CONDITIONS: ConditionWords[] = [
  { id: "sugar", hi: "शुगर", en: "Sugar (diabetes)", aliases: ["sugar", "शुगर", "सुगर", "शक्कर", "मधुमेह", "डायबिटीज", "डायबिटीस", "diabetes", "diabetic", "madhumeh"] },
  { id: "bp", hi: "BP", en: "Blood pressure", aliases: ["bp", "बीपी", "बी पी", "blood pressure", "ब्लड प्रेशर", "रक्तचाप", "hypertension", "high bp", "हाई बीपी", "pressure", "प्रेशर"] },
  { id: "fever", hi: "बुखार / दर्द", en: "Fever / pain", aliases: ["fever", "बुखार", "बुख़ार", "bukhar", "ताप", "pain", "दर्द", "dard", "सिरदर्द", "headache", "बदन दर्द"] },
  { id: "iron", hi: "खून की कमी", en: "Anaemia / pregnancy", aliases: ["anaemia", "anemia", "खून की कमी", "कमजोरी", "pregnancy", "गर्भावस्था", "गर्भवती", "pregnant", "khoon"] },
  { id: "diarrhoea", hi: "दस्त", en: "Diarrhoea", aliases: ["diarrhoea", "diarrhea", "loose motion", "loose motions", "दस्त", "dast", "उल्टी", "पतले दस्त", "dehydration"] },
  { id: "infection", hi: "संक्रमण", en: "Infection", aliases: ["infection", "संक्रमण", "antibiotic", "एंटीबायोटिक", "इन्फेक्शन", "पस", "घाव"] },
  { id: "breathing", hi: "दमा / साँस", en: "Asthma / breathing", aliases: ["asthma", "दमा", "dama", "साँस", "सांस", "saans", "breathing", "साँस फूलना", "अस्थमा"] },
];

/** Words that carry no meaning for the search ("medicine", "where", "is it available"). */
export const STOPWORDS = new Set([
  "की", "का", "के", "को", "में", "है", "हैं", "क्या", "कहाँ", "कहां", "मिलेगी", "मिलेगा", "मिल", "मिलती", "दवा", "दवाई", "दवाएं", "दवाएँ", "गोली", "गोलियां",
  "मुझे", "मेरी", "मेरा", "चाहिए", "आज", "अभी", "पर", "से", "और", "या", "वाली", "उपलब्ध", "स्टॉक", "बताओ", "बताइए", "बताएं", "तो", "भी", "नहीं", "ना", "हमारे", "हमें", "यहाँ", "यहां",
  "ki", "ka", "ke", "ko", "me", "mein", "hai", "kya", "kahan", "kaha", "milegi", "milega", "mil", "dawa", "dawai", "davai", "dava", "goli", "tablet", "tablets", "tab", "medicine", "medicines",
  "the", "is", "at", "in", "my", "for", "a", "an", "of", "where", "can", "i", "get", "available", "stock", "today", "near", "nearby", "please", "chahiye", "aaj", "abhi", "par", "se", "aur", "wali", "do", "you", "have",
  "mg", "500", "40", "50", "5", "2", "गाँव", "गांव", "gaon", "gav", "village", "phc", "chc", "block", "ब्लॉक", "पास", "paas", "nearest", "सबसे", "नजदीक", "नज़दीक","hospital", "अस्पताल",
]);

/** Hindi display names for facilities and blocks (Latin names come from the district data). */
export const PLACE_HI: Record<string, string> = {
  "dh-sehore": "ज़िला अस्पताल सीहोर",
  "chc-ashta": "सामुदायिक स्वास्थ्य केंद्र आष्टा",
  "chc-ichhawar": "सामुदायिक स्वास्थ्य केंद्र इछावर",
  "chc-nasrullaganj": "सामुदायिक स्वास्थ्य केंद्र नसरुल्लागंज",
  "chc-budhni": "सामुदायिक स्वास्थ्य केंद्र बुधनी",
  "chc-shyampur": "सामुदायिक स्वास्थ्य केंद्र श्यामपुर",
  saraswati: "सरस्वती PHC",
  kalyanpur: "कल्याणपुर PHC",
  devgarh: "देवगढ़ PHC",
  rampur: "रामपुर PHC",
  hirapur: "हीरापुर PHC",
  gopalpura: "गोपालपुरा PHC",
  anandpur: "आनंदपुर PHC",
  chandanpura: "चंदनपुरा PHC",
  lakshmipura: "लक्ष्मीपुरा PHC",
  madhavgarh: "माधवगढ़ PHC",
  kamalpur: "कमलपुर PHC",
  tulsipur: "तुलसीपुर PHC",
  sundarpur: "सुंदरपुर PHC",
  narayanpur: "नारायणपुर PHC",
  bhimpura: "भीमपुरा PHC",
  kesarpura: "केसरपुरा PHC",
};

/** Short Hindi labels that fit on one line ("CHC आष्टा"). */
export const PLACE_HI_SHORT: Record<string, string> = {
  "dh-sehore": "ज़िला अस्पताल सीहोर",
  "chc-ashta": "CHC आष्टा",
  "chc-ichhawar": "CHC इछावर",
  "chc-nasrullaganj": "CHC नसरुल्लागंज",
  "chc-budhni": "CHC बुधनी",
  "chc-shyampur": "CHC श्यामपुर",
};

export const BLOCK_HI: Record<string, string> = {
  Sehore: "सीहोर", Ashta: "आष्टा", Ichhawar: "इछावर", Nasrullaganj: "नसरुल्लागंज", Budhni: "बुधनी", Shyampur: "श्यामपुर",
};

/** Extra spellings for facility and block names. */
export const PLACE_ALIASES: Record<string, string[]> = {
  "dh-sehore": ["district hospital", "zila aspatal", "जिला अस्पताल", "सीहोर अस्पताल", "sehore hospital", "बड़ा अस्पताल"],
  "chc-ashta": ["ashta", "आष्टा", "अष्टा"],
  "chc-ichhawar": ["ichhawar", "ichawar", "इछावर", "इच्छावर"],
  "chc-nasrullaganj": ["nasrullaganj", "nasrulaganj", "नसरुल्लागंज", "नसरुलगंज", "bheronda"],
  "chc-budhni": ["budhni", "budni", "बुधनी", "बुदनी"],
  "chc-shyampur": ["shyampur", "श्यामपुर", "शामपुर"],
  saraswati: ["saraswati", "sarasvati", "सरस्वती"],
  kalyanpur: ["kalyanpur", "kalyanpura", "कल्याणपुर"],
  devgarh: ["devgarh", "deogarh", "देवगढ़", "देवगढ"],
  rampur: ["rampur", "रामपुर"],
  hirapur: ["hirapur", "heerapur", "हीरापुर", "हिरापुर"],
  gopalpura: ["gopalpura", "gopalpur", "गोपालपुरा"],
  anandpur: ["anandpur", "आनंदपुर", "आनन्दपुर"],
  chandanpura: ["chandanpura", "चंदनपुरा", "चन्दनपुरा"],
  lakshmipura: ["lakshmipura", "laxmipura", "लक्ष्मीपुरा", "लछमीपुरा"],
  madhavgarh: ["madhavgarh", "माधवगढ़"],
  kamalpur: ["kamalpur", "कमलपुर"],
  tulsipur: ["tulsipur", "तुलसीपुर"],
  sundarpur: ["sundarpur", "सुंदरपुर", "सुन्दरपुर"],
  narayanpur: ["narayanpur", "नारायणपुर"],
  bhimpura: ["bhimpura", "भीमपुरा"],
  kesarpura: ["kesarpura", "केसरपुरा"],
};

export type Village = { id: string; name: string; hi: string; phcId: string; dLat: number; dLng: number };

/** SYNTHETIC villages, each served by one PHC. Coordinates are small offsets from that PHC. */
export const VILLAGES: Village[] = [
  { id: "v-khajuria", name: "Khajuria", hi: "खजुरिया", phcId: "saraswati", dLat: 0.03, dLng: -0.02 },
  { id: "v-semli", name: "Semli", hi: "सेमली", phcId: "saraswati", dLat: -0.025, dLng: 0.03 },
  { id: "v-bamuliya", name: "Bamuliya", hi: "बमूलिया", phcId: "kalyanpur", dLat: 0.02, dLng: 0.025 },
  { id: "v-pipalkheda", name: "Pipalkheda", hi: "पीपलखेड़ा", phcId: "kalyanpur", dLat: -0.03, dLng: -0.015 },
  { id: "v-dhamanda", name: "Dhamanda", hi: "धमांदा", phcId: "devgarh", dLat: 0.025, dLng: 0.02 },
  { id: "v-barkhedi", name: "Barkhedi", hi: "बरखेड़ी", phcId: "devgarh", dLat: -0.02, dLng: -0.03 },
  { id: "v-sukhipura", name: "Sukhipura", hi: "सुखीपुरा", phcId: "rampur", dLat: 0.02, dLng: -0.025 },
  { id: "v-nayagaon", name: "Nayagaon", hi: "नयागाँव", phcId: "rampur", dLat: -0.025, dLng: 0.02 },
  { id: "v-jamuniya", name: "Jamuniya", hi: "जामुनिया", phcId: "hirapur", dLat: 0.03, dLng: 0.01 },
  { id: "v-khadi", name: "Khadi", hi: "खड़ी", phcId: "hirapur", dLat: -0.02, dLng: -0.02 },
  { id: "v-amlaha", name: "Amlaha", hi: "अमलाहा", phcId: "gopalpura", dLat: 0.02, dLng: 0.03 },
  { id: "v-kundi", name: "Kundi", hi: "कुंडी", phcId: "gopalpura", dLat: -0.03, dLng: 0.01 },
  { id: "v-mugaliya", name: "Mugaliya", hi: "मुगलिया", phcId: "anandpur", dLat: 0.025, dLng: -0.02 },
  { id: "v-tilaria", name: "Tilaria", hi: "तिलरिया", phcId: "anandpur", dLat: -0.02, dLng: 0.03 },
  { id: "v-bhatoni", name: "Bhatoni", hi: "भटोनी", phcId: "chandanpura", dLat: 0.02, dLng: 0.02 },
  { id: "v-rolupura", name: "Rolupura", hi: "रोलूपुरा", phcId: "chandanpura", dLat: -0.025, dLng: -0.02 },
  { id: "v-kherkheda", name: "Kherkheda", hi: "खेरखेड़ा", phcId: "lakshmipura", dLat: 0.03, dLng: 0.02 },
  { id: "v-palasi", name: "Palasi", hi: "पलासी", phcId: "lakshmipura", dLat: -0.02, dLng: 0.025 },
  { id: "v-chhapri", name: "Chhapri", hi: "छापरी", phcId: "madhavgarh", dLat: 0.02, dLng: -0.03 },
  { id: "v-gwalbadi", name: "Gwalbadi", hi: "ग्वालबाड़ी", phcId: "madhavgarh", dLat: -0.025, dLng: 0.02 },
  { id: "v-sagoni", name: "Sagoni", hi: "सगोनी", phcId: "kamalpur", dLat: 0.025, dLng: -0.02 },
  { id: "v-tajpura", name: "Tajpura", hi: "ताजपुरा", phcId: "kamalpur", dLat: -0.02, dLng: 0.03 },
  { id: "v-mahukheda", name: "Mahukheda", hi: "महूखेड़ा", phcId: "tulsipur", dLat: 0.03, dLng: 0.02 },
  { id: "v-banskheda", name: "Banskheda", hi: "बाँसखेड़ा", phcId: "tulsipur", dLat: -0.02, dLng: -0.025 },
  { id: "v-dongarpur", name: "Dongarpur", hi: "डोंगरपुर", phcId: "sundarpur", dLat: 0.02, dLng: 0.03 },
  { id: "v-khatpura", name: "Khatpura", hi: "खतपुरा", phcId: "sundarpur", dLat: -0.03, dLng: -0.01 },
  { id: "v-raipura", name: "Raipura", hi: "रायपुरा", phcId: "narayanpur", dLat: 0.025, dLng: -0.025 },
  { id: "v-semalkheda", name: "Semalkheda", hi: "सेमलखेड़ा", phcId: "narayanpur", dLat: -0.02, dLng: 0.02 },
  { id: "v-gadariya", name: "Gadariya", hi: "गड़रिया", phcId: "bhimpura", dLat: 0.02, dLng: 0.025 },
  { id: "v-nipaniya", name: "Nipaniya", hi: "निपानिया", phcId: "bhimpura", dLat: -0.025, dLng: -0.02 },
  { id: "v-bilkhiriya", name: "Bilkhiriya", hi: "बिलखिरिया", phcId: "kesarpura", dLat: 0.03, dLng: -0.015 },
  { id: "v-dhaneriya", name: "Dhaneriya", hi: "धनेरिया", phcId: "kesarpura", dLat: -0.02, dLng: 0.03 },
];
