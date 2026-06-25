import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, validateEmail, validateSignup, isValid } from './App.js';

// Golden hand-written suite — the baseline a good generated run should match or
// beat. Also the shadow-oracle source for eval.
describe('validateEmail (pure)', () => {
  it('accepts a well-formed address', () => {
    expect(validateEmail('a@b.com')).toBe(true);
  });
  it('rejects a malformed address', () => {
    expect(validateEmail('not-an-email')).toBe(false);
  });
});

describe('validateSignup (pure)', () => {
  it('flags missing name and email', () => {
    const errs = validateSignup('', '');
    expect(errs.name).toBe('Name is required');
    expect(errs.email).toBe('Email is required');
    expect(isValid(errs)).toBe(false);
  });
  it('passes a valid signup', () => {
    expect(isValid(validateSignup('Ada', 'ada@example.com'))).toBe(true);
  });
});

describe('App', () => {
  it('shows validation errors on empty submit', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Register' }));
    expect(screen.getByLabelText('name error')).toHaveTextContent('Name is required');
    expect(screen.getByLabelText('member count')).toHaveTextContent('0 members');
  });

  it('registers a member on valid submit', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Register' }));
    expect(screen.getByLabelText('member count')).toHaveTextContent('1 members');
    expect(screen.getByText('Ada <ada@example.com>')).toBeInTheDocument();
  });
});
