import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator'

export class RegisterDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) password!: string
  @ApiProperty() @IsString() @Length(1, 80) firstName!: string
  @ApiProperty() @IsString() @Length(1, 80) lastName!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) referralCode?: string
}

export class LoginDto {
  @ApiProperty() @IsEmail() email!: string
  @ApiProperty() @IsString() @MaxLength(128) password!: string
}

export class GoogleLoginDto {
  @ApiProperty({ description: 'ID token renvoyé par Google Identity Services' })
  @IsString()
  credential!: string
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail() email!: string
}

export class VerifyCodeDto {
  @ApiProperty() @IsEmail() email!: string
  @ApiProperty() @Matches(/^\d{6}$/, { message: 'Le code contient 6 chiffres' }) code!: string
}

export class ResetPasswordDto extends VerifyCodeDto {
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) password!: string
}

export class ChangePasswordDto {
  @ApiPropertyOptional() @IsOptional() @IsString() currentPassword?: string
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) newPassword!: string
}
