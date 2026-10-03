import { CodedNotFoundException } from '../../common/errors/index';

export const customerNotFound = (id: string) =>
  new CodedNotFoundException('CUSTOMER_NOT_FOUND', 'Customer not found', { id });
