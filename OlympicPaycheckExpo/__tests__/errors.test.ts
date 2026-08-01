import { ApiError, messageFor } from '@/api/types';

/**
 * Error copy is the one place a backend failure becomes something an employee
 * reads, so every branch is pinned: wrong text here means a payroll user is
 * told the wrong thing about their own pay.
 */
describe('messageFor', () => {
  it('names the email as the problem when the address is unknown', () => {
    expect(messageFor(new ApiError('INVALID_EMAIL', 'nope'))).toMatch(/email address/i);
  });

  it('points at the last 4 digits on an SSN mismatch', () => {
    expect(messageFor(new ApiError('INVALID_SSN', 'nope'))).toMatch(/last 4 digits/i);
  });

  it('includes how many employees share a duplicated email', () => {
    expect(messageFor(new ApiError('MULTIPLE_EMPLOYEES', 'dupe', 3))).toContain('3 employees');
  });

  it('degrades gracefully when the count is missing', () => {
    const message = messageFor(new ApiError('MULTIPLE_EMPLOYEES', 'dupe'));
    expect(message).toContain('several employees');
    expect(message).not.toContain('undefined');
  });

  it('tells the employee to check their connection on a network failure', () => {
    expect(messageFor(new ApiError('NETWORK', 'offline'))).toMatch(/internet connection/i);
  });

  it('has copy for a missing stub', () => {
    expect(messageFor(new ApiError('NOT_FOUND', 'gone'))).toMatch(/couldn’t find that pay stub/i);
  });

  it('falls back to a generic message for server errors', () => {
    expect(messageFor(new ApiError('SERVER', 'boom'))).toMatch(/on our end/i);
  });

  it('never leaks the underlying error text', () => {
    const raw = 'SqlException: Login failed for user OLYMPIC\\payroll_svc';
    expect(messageFor(new Error(raw))).not.toContain('SqlException');
    expect(messageFor(new Error(raw))).toMatch(/something went wrong/i);
  });

  it('survives a thrown non-Error', () => {
    expect(messageFor('just a string')).toMatch(/something went wrong/i);
    expect(messageFor(undefined)).toMatch(/something went wrong/i);
  });
});
