import { CodedNotFoundException } from '../../common/errors/index';

export const deliveryChargeNotFound = (id: string) =>
  new CodedNotFoundException('DELIVERY_CHARGE_NOT_FOUND', 'Delivery charge not found', { id });
