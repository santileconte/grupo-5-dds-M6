import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EstadoViaje, MotivoCancelacion, TipoVehiculo } from '../dominio/tipos';

// Los DTOs describen lo que llega por HTTP y se validan automáticamente (ver comun/validacion.pipe.ts).
// Deben coincidir con los schemas de contratos/m6-viajes.openapi.yaml.

export class CrearViajeDto {
  @IsUUID()
  requestId!: string;

  @IsOptional()
  @IsUUID()
  reservationId?: string | null;

  @IsUUID()
  clientId!: string;

  @IsUUID()
  driverId!: string;

  @IsUUID()
  vehicleId!: string;

  @IsEnum(TipoVehiculo)
  vehicleType!: TipoVehiculo;

  @IsNumber()
  @Min(-90)
  @Max(90)
  originLatitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  originLongitude!: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  destinationLatitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  destinationLongitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  originAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  destinationAddress?: string;
}

export class IniciarViajeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  verificationToken!: string;
}

export class FinalizarViajeDto {
  /** Kilómetros recorridos, con decimales (por ejemplo 6.4). */
  @IsNumber()
  @Min(0.1)
  distanceKm!: number;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  finalLatitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  finalLongitude?: number;
}

export class CancelarViajeDto {
  @IsEnum(MotivoCancelacion)
  reason!: MotivoCancelacion;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;
}

export class ListarViajesQuery {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  /** Llega como `state=PENDING_ARRIVAL,IN_PROGRESS`. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsEnum(EstadoViaje, { each: true })
  state?: EstadoViaje[];

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}
