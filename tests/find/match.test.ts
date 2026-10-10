import { describe, expect, it } from "vitest";
import { FACILITIES } from "../../lib/district/data";
import { matchCondition, parseQuestion, searchMedicines, searchPlaces } from "../../lib/find/match";
import { canonical, editDistance, normalize, transliterate } from "../../lib/find/text";

const top = (q: string, typeahead = false) => searchMedicines(q, { typeahead })[0]?.medicineId;
const ids = (q: string) => searchMedicines(q).map((h) => h.medicineId);

describe("text normalisation", () => {
  it("transliterates Devanagari so Hindi and English spellings meet", () => {
    expect(canonical("मेटफॉर्मिन")).toBe(canonical("metformin"));
    expect(canonical("सरस्वती")).toBe(canonical("Saraswati"));
    expect(canonical("शुगर")).toBe("sugar");
    expect(transliterate("कल्याणपुर")).toBe("kalyanpur");
  });
  it("strips punctuation, nukta and Devanagari digits", () => {
    expect(normalize("  BP की दवा?! ")).toBe("bp की दवा");
    expect(normalize("मेटफॉर्मिन ५००")).toBe("मेटफॉर्मिन 500");
    expect(normalize("फ़")).toBe("फ");
  });
  it("counts adjacent transpositions as one edit", () => {
    expect(editDistance("metformin", "metfromin")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("medicine search", () => {
  it.each([
    ["metformin", "metformin-500"],
    ["Metformin 500", "metformin-500"],
    ["metfromin", "metformin-500"],
    ["metphormin", "metformin-500"],
    ["मेटफॉर्मिन", "metformin-500"],
    ["मेटफार्मिन", "metformin-500"],
    ["मेटफॉरमिन", "metformin-500"],
    ["glycomet", "metformin-500"],
    ["paracitamol", "paracetamol-500"],
    ["पेरासिटामोल", "paracetamol-500"],
    ["dolo", "paracetamol-500"],
    ["crocin", "paracetamol-500"],
    ["amlodepine", "amlodipine-5"],
    ["telmisartn", "telmisartan-40"],
    ["asthalin", "salbutamol-inhaler"],
    ["दमा का पंप", "salbutamol-inhaler"],
    ["iron ki goli", "ifa-tablets"],
    ["आयरन की गोली", "ifa-tablets"],
    ["ओ आर एस", "ors-sachet"],
    ["amoxy", "amoxicillin-500"],
  ])("%s → %s", (q, id) => {
    expect(top(q)).toBe(id);
  });

  it("maps 'शुगर की दवा' to every diabetes medicine", () => {
    expect(ids("शुगर की दवा")).toEqual(["metformin-500", "glimepiride-2"]);
    expect(ids("sugar ki dawai")).toEqual(["metformin-500", "glimepiride-2"]);
    expect(matchCondition("शुगर की दवा")?.id).toBe("sugar");
  });

  it("maps 'BP की दवा' to amlodipine, telmisartan and atenolol", () => {
    expect(ids("BP की दवा")).toEqual(["amlodipine-5", "telmisartan-40", "atenolol-50"]);
    expect(ids("बी पी की गोली")).toEqual(["amlodipine-5", "telmisartan-40", "atenolol-50"]);
    expect(ids("bp ki goli")).toEqual(["amlodipine-5", "telmisartan-40", "atenolol-50"]);
  });

  it("ranks a named medicine above its condition group", () => {
    const hits = searchMedicines("metformin sugar");
    expect(hits[0]).toMatchObject({ medicineId: "metformin-500", via: "name" });
  });

  it("matches partial words while typing", () => {
    expect(top("metf", true)).toBe("metformin-500");
    expect(top("para", true)).toBe("paracetamol-500");
    expect(top("metf")).toBeUndefined();
  });

  it("returns nothing for filler words or unrelated text", () => {
    expect(searchMedicines("दवा कहाँ मिलेगी")).toEqual([]);
    expect(searchMedicines("tractor")).toEqual([]);
    expect(searchMedicines("")).toEqual([]);
  });

  it("can be limited to the medicines the district stocks", () => {
    expect(searchMedicines("शुगर", { medicineIds: ["glimepiride-2"] }).map((h) => h.medicineId)).toEqual(["glimepiride-2"]);
  });
});

describe("place search", () => {
  it("finds PHCs in Hindi and English with misspellings", () => {
    expect(searchPlaces("sarasvati", FACILITIES)[0]).toMatchObject({ kind: "facility", id: "saraswati" });
    expect(searchPlaces("कल्याणपुर", FACILITIES)[0]).toMatchObject({ id: "kalyanpur" });
    expect(searchPlaces("देवगड", FACILITIES)[0]).toMatchObject({ id: "devgarh" });
  });
  it("maps a village to the PHC that serves it", () => {
    expect(searchPlaces("khajuriya", FACILITIES)[0]).toMatchObject({ kind: "village", facilityId: "saraswati" });
    expect(searchPlaces("सेमली", FACILITIES)[0]).toMatchObject({ kind: "village", facilityId: "saraswati" });
  });
  it("returns both the CHC and the block for a block town", () => {
    const kinds = searchPlaces("ashta", FACILITIES).map((h) => `${h.kind}:${h.id}`);
    expect(kinds).toContain("facility:chc-ashta");
    expect(kinds).toContain("block:Ashta");
  });
  it("never offers the district warehouse to the public", () => {
    expect(searchPlaces("warehouse", FACILITIES).some((h) => h.id === "warehouse-sehore")).toBe(false);
  });
});

describe("parseQuestion", () => {
  it("reads medicine and place from a Hindi question", () => {
    const p = parseQuestion("सरस्वती में शुगर की दवा है क्या?", FACILITIES);
    expect(p.medicineIds).toEqual(["metformin-500", "glimepiride-2"]);
    expect(p.conditionId).toBe("sugar");
    expect(p.place?.id).toBe("saraswati");
  });
  it("reads a Hinglish question", () => {
    const p = parseQuestion("Kalyanpur PHC mein paracetamol milegi?", FACILITIES);
    expect(p).toMatchObject({ medicineIds: ["paracetamol-500"], conditionId: null });
    expect(p.place?.id).toBe("kalyanpur");
  });
  it("reads a village and a condition", () => {
    const p = parseQuestion("मुझे दमा का पंप चाहिए, खजुरिया गाँव", FACILITIES);
    expect(p.medicineIds).toEqual(["salbutamol-inhaler"]);
    expect(p.place).toMatchObject({ kind: "village", facilityId: "saraswati" });
  });
  it("leaves the place empty when none is said", () => {
    expect(parseQuestion("metformin hai kya", FACILITIES).place).toBeNull();
  });
});
