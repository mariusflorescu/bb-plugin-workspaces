export function FieldError({ id, message }: { readonly id: string; readonly message: string | undefined }) {
  return message === undefined ? null : (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}
