import { synthSnapshot, TestProject } from "./util";
import { XmlFile } from "../src";

test("simple use", () => {
  // WHEN
  const project = new TestProject();

  const file = new XmlFile(project, "pom.xml", {
    obj: {
      project: {
        modelVersion: "4.0.0",
        groupId: "com.myorg",
        artifactId: "play-202101050157",
        version: "0.1",
      },
    },
  });

  file.addOverride("project.properties", {
    "project.build.sourceEncoding": "UTF-8",
  });

  // THEN
  expect(synthSnapshot(project)["pom.xml"]).toMatchSnapshot();
});
