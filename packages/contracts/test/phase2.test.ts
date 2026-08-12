import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assessVisitIntegrity,
  distanceInMetres,
  locationQuality,
  MAX_ACCEPTABLE_ACCURACY_METRES,
} from '../src/geo';
import { canTransitionVisit, checkInSchema, checkOutSchema } from '../src/visit';
import {
  formatBytes,
  isAllowedUploadType,
  maxBytesFor,
  sanitiseFileName,
} from '../src/document';
import { createPartnerSchema } from '../src/partner';

describe('geo distance', () => {
  it('is zero for the same point', () => {
    const point = { latitude: 23.0225, longitude: 72.5714 };
    assert.equal(distanceInMetres(point, point), 0);
  });

  it('matches a known distance (Ahmedabad to Surat, ~230 km)', () => {
    const ahmedabad = { latitude: 23.0225, longitude: 72.5714 };
    const surat = { latitude: 21.1702, longitude: 72.8311 };
    const km = distanceInMetres(ahmedabad, surat) / 1000;
    assert.ok(km > 200 && km < 220, `expected ~207 km, got ${km.toFixed(1)} km`);
  });

  it('is symmetric', () => {
    const a = { latitude: 23.0225, longitude: 72.5714 };
    const b = { latitude: 19.076, longitude: 72.8777 };
    assert.equal(distanceInMetres(a, b), distanceInMetres(b, a));
  });

  it('resolves short distances usefully', () => {
    // ~111 m of latitude.
    const a = { latitude: 23.0225, longitude: 72.5714 };
    const b = { latitude: 23.0235, longitude: 72.5714 };
    const metres = distanceInMetres(a, b);
    assert.ok(metres > 100 && metres < 120, `expected ~111 m, got ${metres} m`);
  });
});

describe('location quality', () => {
  it('bands accuracy sensibly', () => {
    assert.equal(locationQuality(8), 'PRECISE');
    assert.equal(locationQuality(60), 'GOOD');
    assert.equal(locationQuality(600), 'APPROXIMATE');
    assert.equal(locationQuality(4000), 'UNRELIABLE');
  });

  it('treats a missing reading as unreliable, never as precise', () => {
    assert.equal(locationQuality(null), 'UNRELIABLE');
    assert.equal(locationQuality(undefined), 'UNRELIABLE');
  });
});

describe('visit integrity', () => {
  const office = { latitude: 23.0225, longitude: 72.5714 };

  it('passes a normal visit', () => {
    const result = assessVisitIntegrity({
      checkIn: office,
      checkOut: { latitude: 23.0226, longitude: 72.5715 },
      checkInAccuracy: 15,
      checkOutAccuracy: 20,
      durationMinutes: 35,
    });
    assert.equal(result.requiresReview, false);
    assert.ok(result.driftMetres !== null && result.driftMetres < 50);
  });

  it('flags a check-out in a different city', () => {
    const result = assessVisitIntegrity({
      checkIn: office,
      checkOut: { latitude: 21.1702, longitude: 72.8311 },
      checkInAccuracy: 10,
      checkOutAccuracy: 10,
      durationMinutes: 40,
    });
    assert.equal(result.requiresReview, true);
    assert.match(result.reasons.join(' '), /km from check-in/);
  });

  it('does not flag drift that sits inside the combined uncertainty', () => {
    // 111 m apart, but both readings are +/- 400 m. Flagging this would be noise.
    const result = assessVisitIntegrity({
      checkIn: office,
      checkOut: { latitude: 23.0235, longitude: 72.5714 },
      checkInAccuracy: 400,
      checkOutAccuracy: 400,
      durationMinutes: 30,
    });
    assert.equal(
      result.reasons.some((reason) => reason.includes('km from check-in')),
      false,
    );
  });

  it('flags an implausibly short visit', () => {
    const result = assessVisitIntegrity({
      checkIn: office,
      checkOut: office,
      checkInAccuracy: 10,
      checkOutAccuracy: 10,
      durationMinutes: 1,
    });
    assert.equal(result.requiresReview, true);
    assert.match(result.reasons.join(' '), /under two minutes/);
  });

  it('flags an unusable check-in fix', () => {
    const result = assessVisitIntegrity({
      checkIn: office,
      checkOut: office,
      checkInAccuracy: 4500,
      checkOutAccuracy: 20,
      durationMinutes: 30,
    });
    assert.equal(result.requiresReview, true);
    assert.match(result.reasons.join(' '), /too imprecise/);
  });
});

describe('visit transitions', () => {
  it('follows plan -> check in -> complete', () => {
    assert.ok(canTransitionVisit('PLANNED', 'CHECKED_IN'));
    assert.ok(canTransitionVisit('CHECKED_IN', 'COMPLETED'));
  });

  it('treats a completed visit as immutable', () => {
    assert.equal(canTransitionVisit('COMPLETED', 'CHECKED_IN'), false);
    assert.equal(canTransitionVisit('COMPLETED', 'CANCELLED'), false);
  });

  it('refuses to complete a visit that was never checked in', () => {
    assert.equal(canTransitionVisit('PLANNED', 'COMPLETED'), false);
  });

  it('refuses to revive a cancelled visit', () => {
    assert.equal(canTransitionVisit('CANCELLED', 'CHECKED_IN'), false);
  });
});

describe('check-in validation', () => {
  const valid = {
    latitude: 23.0225,
    longitude: 72.5714,
    accuracy: 12,
    photoKey: 'visits/2026/abc.jpg',
  };

  it('accepts a well-formed check-in', () => {
    assert.ok(checkInSchema.safeParse(valid).success);
  });

  it('requires a photo — a check-in without one is just a claim', () => {
    const { photoKey, ...withoutPhoto } = valid;
    void photoKey;
    assert.equal(checkInSchema.safeParse(withoutPhoto).success, false);
  });

  it('requires accuracy, so a coordinate always carries its uncertainty', () => {
    const { accuracy, ...withoutAccuracy } = valid;
    void accuracy;
    assert.equal(checkInSchema.safeParse(withoutAccuracy).success, false);
  });

  it('rejects a fix too imprecise to mean anything', () => {
    const result = checkInSchema.safeParse({
      ...valid,
      accuracy: MAX_ACCEPTABLE_ACCURACY_METRES + 1,
    });
    assert.equal(result.success, false);
  });

  it('rejects impossible coordinates', () => {
    assert.equal(checkInSchema.safeParse({ ...valid, latitude: 91 }).success, false);
    assert.equal(checkInSchema.safeParse({ ...valid, longitude: -181 }).success, false);
  });

  it('requires meeting notes at check-out', () => {
    const base = { latitude: 23.02, longitude: 72.57, accuracy: 10 };
    assert.equal(checkOutSchema.safeParse(base).success, false);
    assert.ok(checkOutSchema.safeParse({ ...base, meetingNotes: 'Discussed F&O' }).success);
  });
});

describe('upload safety', () => {
  it('allows only known-good types', () => {
    assert.ok(isAllowedUploadType('image/jpeg'));
    assert.ok(isAllowedUploadType('application/pdf'));
    assert.equal(isAllowedUploadType('application/x-msdownload'), false);
    assert.equal(isAllowedUploadType('text/html'), false);
    assert.equal(isAllowedUploadType('image/svg+xml'), false, 'SVG can carry script');
  });

  it('caps size per type', () => {
    assert.equal(maxBytesFor('image/jpeg'), 10 * 1024 * 1024);
    assert.equal(maxBytesFor('application/pdf'), 20 * 1024 * 1024);
    assert.equal(maxBytesFor('application/x-msdownload'), 0);
  });

  it('strips directory traversal from a filename', () => {
    assert.equal(sanitiseFileName('../../etc/passwd'), 'passwd');
    assert.equal(sanitiseFileName('C:\\Windows\\System32\\evil.pdf'), 'evil.pdf');
  });

  it('strips control characters', () => {
    assert.equal(sanitiseFileName('pan\u0000card.pdf'), 'pancard.pdf');
    assert.equal(sanitiseFileName('note\u001Fs.pdf'), 'notes.pdf');
  });

  it('strips bidirectional overrides used to disguise an extension', () => {
    // Renders as "evilfdp.exe" reversed to look like a PDF.
    assert.equal(sanitiseFileName('evil\u202Efdp.exe'), 'evilfdp.exe');
    assert.equal(sanitiseFileName('a\u2066b\u2069c.pdf'), 'abc.pdf');
  });

  it('never returns an empty name', () => {
    assert.equal(sanitiseFileName(''), 'upload');
    assert.equal(sanitiseFileName('...'), 'upload');
    assert.equal(sanitiseFileName('\u0000\u0001'), 'upload');
  });

  it('caps length', () => {
    assert.ok(sanitiseFileName('a'.repeat(500)).length <= 200);
  });

  it('formats sizes readably', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2 KB');
    assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  });
});

describe('partner validation', () => {
  const valid = {
    name: 'Trinetra Financial Services',
    type: 'AUTHORISED_PERSON' as const,
    email: 'jignesh@trinetrafin.in',
    mobile: '9825011122',
  };

  it('accepts a minimal partner', () => {
    assert.ok(createPartnerSchema.safeParse(valid).success);
  });

  it('validates GSTIN format', () => {
    assert.ok(
      createPartnerSchema.safeParse({ ...valid, gstin: '24AABCT1234A1Z5' }).success,
    );
    assert.equal(createPartnerSchema.safeParse({ ...valid, gstin: 'NOTAGSTIN' }).success, false);
  });

  it('keeps commission within 0-100', () => {
    assert.equal(createPartnerSchema.safeParse({ ...valid, commissionRate: 101 }).success, false);
    assert.equal(createPartnerSchema.safeParse({ ...valid, commissionRate: -1 }).success, false);
    assert.ok(createPartnerSchema.safeParse({ ...valid, commissionRate: 35 }).success);
  });
});
