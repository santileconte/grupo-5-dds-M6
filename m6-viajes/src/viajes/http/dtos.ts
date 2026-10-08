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

export class UbicacionDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  direccion?: string;
}

export class CrearViajeDto {
  @IsUUID()
  solicitudId!: string;

  @IsUUID()
  asignacionId!: string;

  @IsOptional()
  @IsUUID()
  reservaId?: string | null;

  @IsUUID()
  clienteId!: string;

  @IsUUID()
  conductorId!: string;

  @IsUUID()
  vehiculoId!: string;

  @IsEnum(TipoVehiculo)
  tipoVehiculo!: TipoVehiculo;

  @IsObject()
  @ValidateNested()
  @Type(() => UbicacionDto)
  origen!: UbicacionDto;

  @IsObject()
  @ValidateNested()
  @Type(() => UbicacionDto)
  destino!: UbicacionDto;
}

export class IniciarViajeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  codigoVerificacion!: string;
}

export class FinalizarViajeDto {
  @IsInt()
  @Min(0)
  distanciaRecorridaMetros!: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UbicacionDto)
  ubicacionFinal?: UbicacionDto;
}

export class CancelarViajeDto {
  @IsEnum(MotivoCancelacion)
  motivo!: MotivoCancelacion;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  detalle?: string;
}

export class ListarViajesQuery {
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @IsOptional()
  @IsUUID()
  conductorId?: string;

  /** Llega como `estado=ASIGNADO,EN_CURSO`. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsEnum(EstadoViaje, { each: true })
  estado?: EstadoViaje[];

  @IsOptional()
  @IsISO8601({ strict: true })
  desde?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  hasta?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  tamanio: number = 20;
}
