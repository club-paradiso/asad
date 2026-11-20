import { z } from "zod";
import { BOOKING_OPTIONS, type Booking } from "./store";

export const reservationFields = {
  booking: z.enum(BOOKING_OPTIONS),
  reservationNo: z.string().regex(/^(?:[1-9][0-9]?|10[0-8])$/).optional(),
  reservationDate: z.iso.date().refine(date => !date.startsWith("0000")).optional(),
};

export function validReservation(
  { booking, reservationNo, reservationDate }: {
    booking?: Booking;
    reservationNo?: string;
    reservationDate?: string;
  },
  allowDraft = false,
): boolean {
  if (booking === "other") {
    if (allowDraft && reservationNo === undefined && reservationDate === undefined) return true;
    return reservationNo !== undefined && reservationDate !== undefined;
  }
  return reservationDate === undefined && (reservationNo === undefined || booking === "yes");
}
