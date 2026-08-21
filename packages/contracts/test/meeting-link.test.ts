import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkMeetingLink } from '../src/masters';

describe('checkMeetingLink', () => {
  it('accepts the approved hosts', () => {
    for (const link of [
      'https://meet.google.com/abc-defg-hij',
      'https://sihl.zoom.us/j/123456789',
      'https://teams.microsoft.com/l/meetup-join/xyz',
    ]) {
      assert.equal(checkMeetingLink(link).allowed, true, link);
    }
  });

  it('rejects a lookalike host that merely contains an approved one', () => {
    // The attack an allow-list exists to stop: a substring check would pass this.
    const verdict = checkMeetingLink('https://zoom.us.evil.com/j/1');
    assert.equal(verdict.allowed, false);
  });

  it('rejects a host that only ends with the letters, not the domain', () => {
    // "notzoom.us" ends with "zoom.us" as a string but is a different domain.
    assert.equal(checkMeetingLink('https://notzoom.us/j/1').allowed, false);
  });

  it('accepts a genuine subdomain', () => {
    assert.equal(checkMeetingLink('https://acme.zoom.us/j/1').allowed, true);
  });

  it('refuses plain http', () => {
    const verdict = checkMeetingLink('http://meet.google.com/abc');
    assert.equal(verdict.allowed, false);
    assert.match(verdict.reason ?? '', /https/);
  });

  it('refuses other schemes, including javascript', () => {
    for (const link of ['javascript:alert(1)', 'data:text/html,<script>', 'ftp://meet.google.com']) {
      assert.equal(checkMeetingLink(link).allowed, false, link);
    }
  });

  it('refuses anything that is not a URL', () => {
    assert.equal(checkMeetingLink('meet.google.com/abc').allowed, false);
    assert.equal(checkMeetingLink('').allowed, false);
  });

  it('is not fooled by case or padding', () => {
    assert.equal(checkMeetingLink('  https://MEET.GOOGLE.COM/abc  ').allowed, true);
  });

  it('rejects credentials smuggled into the authority', () => {
    // The host here is evil.com; meet.google.com is only the userinfo.
    assert.equal(checkMeetingLink('https://meet.google.com@evil.com/x').allowed, false);
  });
});
