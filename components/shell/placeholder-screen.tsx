export type PlaceholderScreenProps = {
  readonly title: string;
  /** One line saying which story fills this in. Indonesian, like all copy. */
  readonly note: string;
};

/**
 * A route that exists so navigation is real.
 *
 * Every nav destination has one. Without them the active state, the
 * close-on-navigation behaviour and the `aria-current` binding would all be
 * asserted against links that go nowhere — mocked navigation proving mocked
 * navigation works.
 *
 * Deliberately close to empty: the frame has to hold its shape with nothing
 * inside it, which is a criterion of this story rather than an oversight.
 */
export function PlaceholderScreen({ title, note }: PlaceholderScreenProps) {
  return (
    <>
      <h1 className="text-xl font-medium tracking-tight">{title}</h1>
      <p className="text-ui-body max-w-prose text-xs">{note}</p>
    </>
  );
}
