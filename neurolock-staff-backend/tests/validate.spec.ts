import { ApiError } from '../src/utils/http';
import { dateStr, email, int, isValidDate, nullableStr, oneOf, str } from '../src/utils/validate';

const expectValidationError = (fn: () => unknown) => {
    try {
        fn();
    } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(400);
        return;
    }
    throw new Error('Expected a validation error');
};

describe('validation helpers', () => {
    it('trims and bounds strings', () => {
        expect(str({ name: '  Riya  ' }, 'name')).toBe('Riya');
        expect(str({}, 'name')).toBeUndefined();
        expectValidationError(() => str({}, 'name', { required: true }));
        expectValidationError(() => str({ name: 'x'.repeat(300) }, 'name', { max: 255 }));
    });

    it('distinguishes cleared from absent values', () => {
        expect(nullableStr({ ward: '' }, 'ward')).toBeNull();
        expect(nullableStr({}, 'ward')).toBeUndefined();
        expect(nullableStr({ ward: 'A' }, 'ward')).toBe('A');
    });

    it('validates calendar dates', () => {
        expect(isValidDate('2024-02-29')).toBe(true);
        expect(isValidDate('2023-02-29')).toBe(false);
        expect(dateStr({ dob: '1996-05-17' }, 'dob')).toBe('1996-05-17');
        expectValidationError(() => dateStr({ dob: '17/05/1996' }, 'dob'));
    });

    it('validates integers, enums and emails', () => {
        expect(int({ n: '42' }, 'n', { min: 0, max: 100 })).toBe(42);
        expectValidationError(() => int({ n: '4.2' }, 'n'));
        expectValidationError(() => int({ n: 500 }, 'n', { max: 100 }));
        expect(oneOf({ s: 'ACTIVE' }, 's', ['active', 'inactive'] as const)).toBe('active');
        expectValidationError(() => oneOf({ s: 'deleted' }, 's', ['active', 'inactive'] as const));
        expect(email({ email: 'Nurse@NeuroLock.com' })).toBe('nurse@neurolock.com');
        expectValidationError(() => email({ email: 'not-an-email' }));
    });
});
